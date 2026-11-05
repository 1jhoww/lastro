import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/management.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { featureNotInPlan } from '../users/permissions.js';
import { cursorPage } from '../../shared/operations/cursorPage.js';
import type { FinancialCommands } from '../finance/financialCommands.js';
import { companyDate } from '../orders/calculation.js';
import { supplierCreditsAvailable } from './supplierCreditAccess.js';
import { creditedTitle, uncreditedTitle } from './titles.js';

const MAX_MOVEMENTS = 200;

export function supplierCreditRecord(input: {
  purchase: s.Purchase;
  closureId: string;
  kind: s.SupplierCredit['kind'];
  amountCents: number;
  issuedOn: string;
  actor: Actor;
  now: string;
}) {
  const { purchase, actor, now } = input;
  return s.supplierCreditSchema.parse({
    id: digest(`supplier-credit:${input.closureId}`),
    tenantId: purchase.tenantId,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplierName,
    purchaseId: purchase.id,
    purchaseCode: purchase.commercialId,
    closureId: input.closureId,
    kind: input.kind,
    originalCents: input.amountCents,
    appliedCents: 0,
    recoveredCents: 0,
    balanceCents: input.amountCents,
    hasBalance: true,
    status: 'open',
    issuedOn: input.issuedOn,
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.uid,
    updatedBy: actor.uid,
    schemaVersion: 1,
  });
}

/** Balance after an application, a recovery or their reversal; `delta` is what leaves it. */
function movedCredit(
  credit: s.SupplierCredit,
  type: s.SupplierCreditMovement['type'],
  delta: number,
  actor: Actor,
  now: string,
) {
  const balanceCents = credit.balanceCents - delta;
  return s.supplierCreditSchema.parse({
    ...credit,
    appliedCents: credit.appliedCents + (type === 'applied' ? delta : 0),
    recoveredCents: credit.recoveredCents + (type === 'recovered' ? delta : 0),
    balanceCents,
    hasBalance: balanceCents > 0,
    status: balanceCents > 0 ? 'open' : 'settled',
    version: credit.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
}

/**
 * What the supplier owes back after a purchase was closed short. A credit lowers a later title of
 * the same supplier without moving money; a recovery is cash coming back and enters the realized
 * flow. Every movement stays on record, and a reversal marks it instead of erasing it.
 */
export class SupplierCreditService {
  constructor(readonly commands: FinancialCommands) {}
  private get repo() {
    return this.commands.repo;
  }
  private today(ctx: TenantContext) {
    return companyDate(this.commands.clock(), ctx.tenant.timezone);
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const credit = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'supplierCredits', id),
      s.supplierCreditSchema,
      tx,
    );
    requireCondition(
      credit?.id === id && credit.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return credit;
  }
  private async title(tx: Transaction, tenantId: string, id: string) {
    const title = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'payables', id),
      s.payableSchema,
      tx,
    );
    requireCondition(
      title?.id === id && title.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return title;
  }
  /** Reading follows the role; applying or recovering a credit still needs the payables feature. */
  private async requireReadable(actor: Actor, tenantId: string, tx: Transaction) {
    const ctx = await this.commands.access.tenant(actor, tenantId, 'supplier-credits:read', tx);
    const db = this.repo.foundation.db;
    if (!(await supplierCreditsAvailable(db, tenantId, ctx.entitlements, tx)))
      throw featureNotInPlan();
  }
  private requireUsable(credit: s.SupplierCredit, expectedVersion: number, amountCents: number) {
    requireCondition(credit.version === expectedVersion, 409, 'CONFLICT', 'Versão desatualizada');
    requireCondition(
      amountCents <= credit.balanceCents,
      409,
      'CREDIT_EXCEEDS_BALANCE',
      'Valor acima do saldo do crédito',
    );
  }
  private movement(
    credit: s.SupplierCredit,
    id: string,
    actor: Actor,
    now: string,
    fields: {
      type: s.SupplierCreditMovement['type'];
      amountCents: number;
      date: string;
      payableId: string | null;
      payableDescription: string | null;
      notes: string;
    },
  ) {
    return s.supplierCreditMovementSchema.parse({
      ...fields,
      id,
      tenantId: credit.tenantId,
      creditId: credit.id,
      supplierId: credit.supplierId,
      status: 'active',
      recordedAt: now,
      createdBy: actor.uid,
      reversedAt: null,
      reversedBy: null,
      reversalReason: null,
      requestId: actor.requestId,
      schemaVersion: 1,
    });
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.supplierCreditQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.requireReadable(actor, tenantId, tx);
        const status = input.status ?? 'open';
        let query: Query = this.repo.ref(tenantId, 'supplierCredits', 'placeholder').parent;
        if (status !== 'all') query = query.where('hasBalance', '==', status === 'open');
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'supplierCredits',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.supplierCreditSchema,
        });
      },
      { readOnly: true },
    );
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.requireReadable(actor, tenantId, tx);
        return this.load(tx, tenantId, id);
      },
      { readOnly: true },
    );
  }
  async movements(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.requireReadable(actor, tenantId, tx);
        await this.load(tx, tenantId, id);
        const page = await tx.get(
          this.repo
            .ref(tenantId, 'supplierCreditMovements', 'placeholder')
            .parent.where('creditId', '==', id)
            .limit(MAX_MOVEMENTS),
        );
        const items = page.docs
          .map((doc) => s.supplierCreditMovementSchema.parse(doc.data()))
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
        return { items };
      },
      { readOnly: true },
    );
  }
  apply(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.supplierCreditApplication>,
    key: string,
  ) {
    const movementId = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'supplier-credit.apply',
      id,
      input,
      'payables:manage',
      s.supplierCreditResult,
      false,
      async (tx, ctx, _operationId, now) => {
        const credit = await this.load(tx, tenantId, id);
        this.requireUsable(credit, input.expectedVersion, input.amountCents);
        const title = await this.title(tx, tenantId, input.payableId);
        requireCondition(
          title.origin === 'purchase' && title.beneficiaryId === credit.supplierId,
          409,
          'CREDIT_TITLE_MISMATCH',
          'O crédito só compensa títulos de compra do mesmo fornecedor',
        );
        requireCondition(title.hasBalance, 409, 'PAYABLE_CLOSED', 'Título sem saldo em aberto');
        requireCondition(
          input.amountCents <= title.outstandingCents,
          409,
          'PAYMENT_EXCEEDS_BALANCE',
          'Valor acima do saldo do título',
        );
        const date = this.today(ctx);
        const next = movedCredit(credit, 'applied', input.amountCents, actor, now);
        const movement = this.movement(credit, movementId, actor, now, {
          type: 'applied',
          amountCents: input.amountCents,
          date,
          payableId: title.id,
          payableDescription: title.description,
          notes: input.notes ?? '',
        });
        tx.set(
          this.repo.ref(tenantId, 'payables', title.id),
          creditedTitle(title, input.amountCents, actor, date, now),
        );
        tx.set(this.repo.ref(tenantId, 'supplierCredits', id), next);
        tx.create(this.repo.ref(tenantId, 'supplierCreditMovements', movementId), movement);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'supplier-credit.applied', id, now, {
          movementId,
          payableId: title.id,
          amountCents: input.amountCents,
        });
        return s.supplierCreditResult.parse({ credit: next, movement });
      },
    );
  }
  recover(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.supplierCreditRecovery>,
    key: string,
  ) {
    const movementId = randomUUID();
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'supplier-credit.recover',
      id,
      input,
      'payables:manage',
      s.supplierCreditResult,
      false,
      async (tx, ctx, _operationId, now) => {
        const credit = await this.load(tx, tenantId, id);
        this.requireUsable(credit, input.expectedVersion, input.amountCents);
        requireCondition(
          input.recoveredOn <= this.today(ctx),
          422,
          'INVALID_PAYMENT_DATE',
          'O recebimento não pode ter data futura',
        );
        const next = movedCredit(credit, 'recovered', input.amountCents, actor, now);
        const movement = this.movement(credit, movementId, actor, now, {
          type: 'recovered',
          amountCents: input.amountCents,
          date: input.recoveredOn,
          payableId: null,
          payableDescription: null,
          notes: input.notes ?? '',
        });
        tx.set(this.repo.ref(tenantId, 'supplierCredits', id), next);
        tx.create(this.repo.ref(tenantId, 'supplierCreditMovements', movementId), movement);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'supplier-credit.recovered',
          id,
          now,
          { movementId, amountCents: input.amountCents, recoveredOn: input.recoveredOn },
        );
        return s.supplierCreditResult.parse({ credit: next, movement });
      },
    );
  }
  reverse(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.supplierCreditReversal>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'supplier-credit.reverse',
      id,
      input,
      'payables:reverse',
      s.supplierCreditResult,
      false,
      async (tx, _ctx, _operationId, now) => {
        const ref = this.repo.ref(tenantId, 'supplierCreditMovements', id);
        const movement = await this.repo.foundation.read(ref, s.supplierCreditMovementSchema, tx);
        requireCondition(
          movement?.id === id && movement.tenantId === tenantId,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        requireCondition(
          movement.status === 'active',
          409,
          'MOVEMENT_ALREADY_REVERSED',
          'Movimentação já estornada',
        );
        const credit = await this.load(tx, tenantId, movement.creditId);
        const title = movement.payableId
          ? await this.title(tx, tenantId, movement.payableId)
          : null;
        const next = movedCredit(credit, movement.type, -movement.amountCents, actor, now);
        const reversed = s.supplierCreditMovementSchema.parse({
          ...movement,
          status: 'reversed',
          reversedAt: now,
          reversedBy: actor.uid,
          reversalReason: input.reason,
        });
        if (title)
          tx.set(
            this.repo.ref(tenantId, 'payables', title.id),
            uncreditedTitle(title, movement.amountCents, actor, now),
          );
        tx.set(this.repo.ref(tenantId, 'supplierCredits', credit.id), next);
        tx.set(ref, reversed);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'supplier-credit.reversed',
          credit.id,
          now,
          { movementId: id, reason: input.reason, amountCents: movement.amountCents },
        );
        return s.supplierCreditResult.parse({ credit: next, movement: reversed });
      },
    );
  }
}
