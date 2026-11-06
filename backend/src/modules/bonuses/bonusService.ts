import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { z } from 'zod';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import * as s from '../../shared/schemas/bonuses.js';
import { customerSchema } from '../../shared/schemas/commercial.js';
import { identitySchema, membershipSchema } from '../../shared/schemas/models.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson, encodeCursor, decodeCursor } from '../../shared/utils/crypto.js';
import { checkReadBudget } from '../../shared/operations/readBudget.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { snapshotLine } from '../orders/calculation.js';
import { addDays } from '../reports/dates.js';
import { parseQuantity } from '../inventory/quantities.js';
import { StockLedger } from '../inventory/stockLedger.js';
import { bonusCostSnapshot } from '../costing/orderCosts.js';
import { brandingAllowed, hasFeature } from '../plans/catalog.js';
import { holds } from '../users/permissions.js';
import { netCost, returnedLine } from './calculation.js';
import { bonusLine, bonusNumber, linePrices, recordBonusEvent } from './orderBonus.js';

const isAdmin = (ctx: TenantContext) => ctx.membership.role === 'administrator';

/**
 * Bonuses as records of their own. Administrators see the whole company; a seller holding
 * `bonuses:grant` sees the bonuses under their responsibility for customers still in their
 * portfolio, the same rule orders follow. Costs live in `bonusCostSnapshots` and only reach
 * callers holding `costs:read`. Nothing here creates an order, a receivable or revenue.
 */
export class BonusService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly inventory: InventoryService,
    readonly clock: () => Date,
    readonly zonedStart: (date: string, timezone: string) => string,
    readonly auth: Pick<Auth, 'getUsers'>,
  ) {}
  /** Names come from the identity provider; bonuses stay correct without them. */
  async people(uids: readonly string[]) {
    const names = new Map<string, string>();
    const unique = [...new Set(uids)];
    try {
      for (let i = 0; i < unique.length; i += 100) {
        const result = await this.auth.getUsers(unique.slice(i, i + 100).map((uid) => ({ uid })));
        for (const user of result.users)
          names.set(user.uid, user.displayName?.trim() || user.email?.trim() || 'Usuário sem nome');
      }
    } catch {
      return names;
    }
    return names;
  }
  private ref(tenantId: string, id: string) {
    return this.repo.ref(tenantId, 'bonuses', id);
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const bonus = await this.repo.foundation.read(this.ref(tenantId, id), s.bonusSchema, tx);
    requireCondition(
      bonus?.id === id && bonus.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return bonus;
  }
  private async customer(tx: Transaction, ctx: TenantContext, id: string) {
    const customer = await this.repo.foundation.read(
      this.repo.ref(ctx.tenant.id, 'customers', id),
      customerSchema,
      tx,
    );
    requireCondition(
      customer?.id === id &&
        customer.tenantId === ctx.tenant.id &&
        (isAdmin(ctx) || customer.assignedTo === ctx.actor.uid),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return customer;
  }
  private async visible(tx: Transaction, ctx: TenantContext, bonus: s.Bonus) {
    if (isAdmin(ctx)) return;
    requireCondition(
      bonus.responsibleUid === ctx.actor.uid && bonus.customerId !== null,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    await this.customer(tx, ctx, bonus.customerId);
  }
  private async responsible(tx: Transaction, ctx: TenantContext, uid: string) {
    const [member, identity] = await Promise.all([
      this.repo.foundation.read(
        this.repo.foundation.tenant(ctx.tenant.id, 'memberships', uid),
        membershipSchema,
        tx,
      ),
      this.repo.foundation.read(this.repo.foundation.global('identities', uid), identitySchema, tx),
    ]);
    requireCondition(
      member?.uid === uid &&
        member.tenantId === ctx.tenant.id &&
        member.status === 'active' &&
        identity?.status === 'active',
      422,
      'INVALID_RESPONSIBLE',
      'Responsável deve possuir vínculo ativo na empresa',
    );
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.bonusQuery>) {
    const page = await this.repo.foundation.readBudget.run(() =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const ctx = await this.access.tenant(actor, tenantId, 'bonuses:grant', tx);
          const seller = !isAdmin(ctx);
          let query: Query = this.ref(tenantId, 'placeholder').parent;
          if (seller) query = query.where('responsibleUid', '==', actor.uid);
          if (input.kind) query = query.where('kind', '==', input.kind);
          if (input.customerId) {
            await this.customer(tx, ctx, input.customerId);
            query = query.where('customerId', '==', input.customerId);
          }
          // Drafts have no date, so this bound also keeps them out of the history.
          const timezone = ctx.tenant.timezone;
          query = query.where(
            'occurredAt',
            '>=',
            input.from ? this.zonedStart(input.from, timezone) : '0',
          );
          if (input.to)
            query = query.where('occurredAt', '<', this.zonedStart(addDays(input.to, 1), timezone));
          query = query.orderBy('occurredAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
          const scope = digest(
            stableJson({
              tenantId,
              actor: actor.uid,
              seller,
              input: { ...input, cursor: undefined },
            }),
          );
          const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
          if (cursor) {
            const previous = await this.load(tx, tenantId, cursor);
            requireCondition(
              previous.occurredAt && (!seller || previous.responsibleUid === actor.uid),
              422,
              'VALIDATION_ERROR',
              'Cursor indisponível',
            );
            query = query.startAfter(previous.occurredAt, cursor);
          }
          const limit = Number(input.limit ?? '25'),
            page = await tx.get(query.limit(limit + 1)),
            docs = page.docs.slice(0, limit);
          const portfolio = seller ? await this.repo.portfolio(tenantId, actor.uid, tx) : null;
          const items: z.infer<typeof s.bonusView>[] = [];
          for (const doc of docs) {
            checkReadBudget();
            const bonus = await this.repo.foundation.readSnapshot(doc, s.bonusSchema, tx);
            requireCondition(
              bonus?.id === doc.id && bonus.tenantId === tenantId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            if (!portfolio || (bonus.customerId && portfolio.has(bonus.customerId)))
              items.push(s.bonusView.parse(bonus));
          }
          return {
            items,
            nextCursor:
              page.size > limit
                ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
                : null,
          };
        },
        { readOnly: true },
      ),
    );
    const names = await this.people(page.items.map((b) => b.responsibleUid));
    return {
      ...page,
      items: page.items.map((b) => ({
        ...b,
        responsibleName: names.get(b.responsibleUid) ?? null,
      })),
    };
  }
  async get(actor: Actor, tenantId: string, id: string) {
    const detail = await this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'bonuses:grant', tx);
        const bonus = await this.load(tx, tenantId, id);
        await this.visible(tx, ctx, bonus);
        const [snapshot, events] = await Promise.all([
          holds(ctx, 'costs:read')
            ? this.repo.foundation.read(
                this.repo.ref(tenantId, 'bonusCostSnapshots', id),
                s.bonusCostSnapshotSchema,
                tx,
              )
            : null,
          tx.get(
            this.repo
              .ref(tenantId, 'bonusEvents', 'placeholder')
              .parent.where('bonusId', '==', id)
              .orderBy('occurredAt')
              .limit(100),
          ),
        ]);
        return {
          ...bonus,
          cost: snapshot ? netCost(bonus, snapshot) : null,
          history: events.docs.map((doc) => s.bonusEventSchema.parse(doc.data())),
        };
      },
      { readOnly: true },
    );
    const names = await this.people([detail.responsibleUid]);
    return s.bonusDetailView.parse({
      ...detail,
      responsibleName: names.get(detail.responsibleUid) ?? null,
    });
  }
  private async replay(
    tx: Transaction,
    actor: Actor,
    tenantId: string,
    operationId: string,
    payloadHash: string,
  ) {
    const ref = this.repo.ref(tenantId, 'bonusOperations', operationId);
    const data = await this.repo.foundation.read(ref, s.bonusOperationSchema, tx);
    requireCondition(
      !data || (data.actorUid === actor.uid && data.payloadHash === payloadHash),
      409,
      'CONFLICT',
      'Chave de idempotência já utilizada com outro comando',
    );
    return { ref, previous: data ? s.bonusView.parse(data.result) : null };
  }
  /** Stock leaves here, once: the summary the user approved is the last step before this call. */
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.bonusCreate>, key: string) {
    const id = randomUUID(),
      operationId = digest(`bonuses:${key}`),
      payloadHash = digest(stableJson({ action: 'create', input })),
      now = this.clock().toISOString();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'bonuses:grant', tx);
      const { ref, previous } = await this.replay(tx, actor, tenantId, operationId, payloadHash);
      if (previous) return previous;
      const responsibleUid = input.responsibleUid ?? actor.uid;
      requireCondition(
        isAdmin(ctx) || responsibleUid === actor.uid,
        403,
        'FORBIDDEN',
        'Operação não permitida',
      );
      await this.responsible(tx, ctx, responsibleUid);
      const customer = await this.customer(tx, ctx, input.customerId);
      requireCondition(
        customer.status === 'active' && customer.relationships.includes('customer'),
        409,
        'CUSTOMER_INACTIVE',
        'Cliente inativo',
      );
      const ledger = new StockLedger(this.inventory, tx, tenantId);
      const rows = await Promise.all(
        input.lines.map(async (line) => {
          const product = await ledger.product(line.productId);
          requireCondition(
            product?.id === line.productId && product.tenantId === tenantId,
            404,
            'RESOURCE_NOT_FOUND',
            'Recurso não encontrado',
          );
          requireCondition(
            product.status === 'active',
            409,
            'PRODUCT_UNAVAILABLE',
            'Produto inativo',
          );
          return { product, line: snapshotLine(randomUUID(), product, line.quantity) };
        }),
      );
      const lines = rows.map((row) => bonusLine(row.line));
      const costs = hasFeature(ctx.entitlements, 'costing.products')
        ? await bonusCostSnapshot(this.repo, tx, tenantId, id, lines, now)
        : null;
      for (const { product, line } of rows)
        ledger.stage(product, {
          id: digest(`${operationId}:${line.id}`),
          type: 'STOCK_BONUS_OUT',
          quantityScaled: parseQuantity(line.quantity, line.unit),
          origin: 'bonus',
          originReference: id,
          actorUid: actor.uid,
          reason: 'Bonificação avulsa',
          notes: bonusNumber(id).slice(0, 12),
          occurredAt: now,
          requestId: actor.requestId,
          operationId,
        });
      const bonus = s.bonusSchema.parse({
        id,
        tenantId,
        commercialId: bonusNumber(id),
        kind: 'standalone',
        orderId: null,
        orderCommercialId: null,
        customerId: customer.id,
        customerName: customer.name,
        responsibleUid,
        status: 'dispatched',
        lines,
        linePrices: linePrices(rows.map((row) => row.line)),
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? null,
        notes: input.notes ?? '',
        occurredAt: now,
        dispatchedAt: now,
        canceledAt: null,
        canceledBy: null,
        version: 1,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      const operation = {
        actorUid: actor.uid,
        bonusId: id,
        payloadHash,
        result: bonus,
        createdAt: now,
        schemaVersion: 1,
      };
      assertDocumentFits(this.ref(tenantId, id).path, bonus);
      assertDocumentFits(ref.path, operation);
      ledger.apply();
      tx.create(this.ref(tenantId, id), bonus);
      if (costs) tx.create(this.repo.ref(tenantId, 'bonusCostSnapshots', id), costs);
      recordBonusEvent(this.repo, tx, actor, bonus, 'created', null, operationId);
      tx.create(ref, operation);
      return s.bonusView.parse(bonus);
    });
  }
  /**
   * Partial or total return of goods that left the stock, administrators only. Sellable units go
   * back to the physical balance at the current average cost, which stays unchanged; damaged
   * units are recorded and never reach the balance. The original movements stay untouched.
   */
  async registerReturn(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.bonusReturnInput>,
    key: string,
  ) {
    const operationId = digest(`bonuses:${key}`),
      payloadHash = digest(stableJson({ action: 'return', id, input })),
      now = this.clock().toISOString();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'returns:manage', tx);
      const { ref, previous } = await this.replay(tx, actor, tenantId, operationId, payloadHash);
      if (previous) return previous;
      const bonus = await this.load(tx, tenantId, id);
      requireCondition(
        bonus.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Bonificação alterada; recarregue',
      );
      requireCondition(
        bonus.status === 'dispatched',
        409,
        'INVALID_BONUS_STATE',
        'Retorno exige bonificação que já saiu do estoque',
      );
      const ledger = new StockLedger(this.inventory, tx, tenantId);
      const byId = new Map(bonus.lines.map((line) => [line.id, line]));
      const rows = await Promise.all(
        input.lines.map(async (item) => {
          const line = byId.get(item.lineId);
          requireCondition(line, 404, 'RESOURCE_NOT_FOUND', 'Linha não pertence à bonificação');
          const product = await ledger.product(line.productId);
          requireCondition(
            product?.id === line.productId && product.unit === line.unit,
            409,
            'PRODUCT_UNAVAILABLE',
            'Produto indisponível ou unidade alterada',
          );
          const sellable = parseQuantity(item.sellable, line.unit),
            damaged = parseQuantity(item.damaged, line.unit);
          return { item, line, product, sellable, damaged };
        }),
      );
      for (const { line, product, sellable, damaged } of rows) {
        byId.set(line.id, returnedLine(line, sellable, damaged));
        if (sellable > 0)
          ledger.stage(product, {
            id: digest(`${operationId}:${line.id}`),
            type: 'STOCK_BONUS_RETURN',
            quantityScaled: sellable,
            origin: 'bonus',
            originReference: bonus.id,
            actorUid: actor.uid,
            reason: input.reason,
            notes: bonus.commercialId.slice(0, 12),
            occurredAt: now,
            requestId: actor.requestId,
            operationId,
          });
      }
      const next = s.bonusSchema.parse({
        ...bonus,
        lines: bonus.lines.map((line) => byId.get(line.id)!),
        version: bonus.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      const operation = {
        actorUid: actor.uid,
        bonusId: id,
        payloadHash,
        result: next,
        createdAt: now,
        schemaVersion: 1,
      };
      assertDocumentFits(ref.path, operation);
      ledger.apply();
      tx.set(this.ref(tenantId, id), next);
      recordBonusEvent(
        this.repo,
        tx,
        actor,
        next,
        'returned',
        input.reason,
        operationId,
        rows.map(({ item }) => ({
          lineId: item.lineId,
          sellable: item.sellable,
          damaged: item.damaged,
        })),
      );
      tx.create(ref, operation);
      return s.bonusView.parse(next);
    });
  }
  /** Everything the receipt prints, read under the current authorization. */
  async receipt(tx: Transaction, actor: Actor, tenantId: string, id: string) {
    const ctx = await this.access.tenant(actor, tenantId, 'bonuses:grant', tx);
    const bonus = await this.load(tx, tenantId, id);
    await this.visible(tx, ctx, bonus);
    const customer = bonus.customerId
      ? await this.repo.foundation.read(
          this.repo.ref(tenantId, 'customers', bonus.customerId),
          customerSchema,
          tx,
        )
      : null;
    const branded = brandingAllowed(ctx.entitlements);
    return {
      bonus,
      customer,
      branded,
      tenant: {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        timezone: ctx.tenant.timezone,
        logo: branded ? ctx.tenant.logo : null,
      },
    };
  }
}
