import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import type { OrderService } from '../orders/orderService.js';
import type { Actor, TenantContext } from '../../shared/types/context.js';
import { customerSchema, searchKey } from '../../shared/schemas/commercial.js';
import {
  membershipSchema,
  identitySchema,
  opaqueId,
  instant,
} from '../../shared/schemas/models.js';
import { orderSchema, orderStatus } from '../../shared/schemas/orders.js';
import * as s from '../../shared/schemas/visits.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest, stableJson, encodeCursor, decodeCursor } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { checkReadBudget, ReadGate } from '../../shared/operations/readBudget.js';
import { PORTFOLIO_CAP } from '../../infrastructure/repositories/commercialRepository.js';
import { REPURCHASE, compareRepurchase, estimateRepurchase, shiftDate } from './repurchase.js';

/** Most confirmed orders scanned for the company-wide repurchase view. */
export const REPURCHASE_ORDER_CAP = 5000;
/** Recent orders of one customer read for its own estimate. */
const CUSTOMER_ORDER_SCAN = 60;
/** Visits examined per list page when the seller scope filters some out. */
const VISIT_SCAN = 100;

/** Local calendar date (YYYY-MM-DD) of an instant in the company timezone. */
export const localDay = (at: string | Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof at === 'string' ? new Date(at) : at);

/** Purchase facts read without the full order document (projection queries). */
const purchaseFacts = z.object({
  tenantId: opaqueId,
  customerId: opaqueId.nullable(),
  status: orderStatus,
  confirmedAt: instant.nullable(),
});
const isPurchase = (o: z.infer<typeof purchaseFacts>) =>
  (o.status === 'confirmed' || o.status === 'dispatched') && o.confirmedAt !== null;

const isAdmin = (ctx: TenantContext) => ctx.membership.role === 'administrator';

/**
 * Commercial visits, customer relationship history and repurchase estimates.
 *
 * Visibility follows the customer's current portfolio, decided by the server: administrators
 * see the whole company; a seller sees records of customers currently assigned to them,
 * whoever authored the record. Moving a customer to another seller changes who sees its
 * history, never who authored it. Nothing here writes stock, receivables or payments.
 */
export class VisitService {
  private readonly gate = new ReadGate(2);
  constructor(
    readonly orders: OrderService,
    readonly auth: Auth,
  ) {}
  private get repo() {
    return this.orders.repo;
  }
  private get access() {
    return this.orders.access;
  }
  private collection(tenantId: string, name: 'visits' | 'orders' | 'customers') {
    return this.repo.ref(tenantId, name, 'placeholder').parent;
  }

  /** Customer of the caller's scope; anything else answers 404 without confirming existence. */
  private async visibleCustomer(tx: Transaction, ctx: TenantContext, id: string) {
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

  /**
   * Related orders the caller may open in Pedidos: administrators any, sellers only their own
   * (the customer is already in their portfolio). Also returns each order's current status.
   */
  private async orderAccess(tx: Transaction, ctx: TenantContext, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    const result = new Map<
      string,
      { accessible: boolean; status: z.infer<typeof orderStatus> | null }
    >();
    if (!unique.length) return result;
    checkReadBudget();
    const snapshots = await tx.getAll(
      ...unique.map((id) => this.repo.ref(ctx.tenant.id, 'orders', id)),
      { fieldMask: ['tenantId', 'sellerUid', 'status'] },
    );
    for (const snapshot of snapshots) {
      const tenantId: unknown = snapshot.get('tenantId');
      const sellerUid: unknown = snapshot.get('sellerUid');
      const status = orderStatus.safeParse(snapshot.get('status'));
      const exists = snapshot.exists && tenantId === ctx.tenant.id;
      result.set(snapshot.id, {
        accessible: exists && (isAdmin(ctx) || sellerUid === ctx.actor.uid),
        status: exists && status.success ? status.data : null,
      });
    }
    return result;
  }

  /** Current customer names for a page (records keep a snapshot as fallback). */
  private async customerNames(tx: Transaction, tenantId: string, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    const names = new Map<string, string>();
    if (!unique.length) return names;
    checkReadBudget();
    const snapshots = await tx.getAll(
      ...unique.map((id) => this.repo.ref(tenantId, 'customers', id)),
      { fieldMask: ['tenantId', 'name'] },
    );
    for (const snapshot of snapshots) {
      const name: unknown = snapshot.get('name');
      if (snapshot.exists && snapshot.get('tenantId') === tenantId && typeof name === 'string')
        names.set(snapshot.id, name);
    }
    return names;
  }

  /** Display names from the identity provider; best effort, like reports and the team list. */
  private async people(uids: readonly (string | null)[]) {
    const names = new Map<string, string>();
    const unique = [...new Set(uids.filter((uid): uid is string => uid !== null))];
    try {
      for (let i = 0; i < unique.length; i += 100) {
        const result = await this.auth.getUsers(unique.slice(i, i + 100).map((uid) => ({ uid })));
        for (const user of result.users)
          names.set(user.uid, user.displayName?.trim() || user.email?.trim() || 'Usuário sem nome');
      }
    } catch {
      // Records stay correct without names.
    }
    return names;
  }

  private view(
    visit: s.Visit,
    accessible: boolean,
    names: Map<string, string>,
    customerName?: string,
  ) {
    const { tenantId: _tenant, payloadHash: _hash, schemaVersion: _version, ...fields } = visit;
    return s.visitView.parse({
      ...fields,
      customerName: customerName ?? visit.customerName,
      responsibleName: names.get(visit.responsibleUid) ?? null,
      orderAccessible: visit.orderId !== null && accessible,
    });
  }

  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.visitQuery>) {
    const page = await this.repo.foundation.readBudget.run(() =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const ctx = await this.access.tenant(actor, tenantId, 'visits:own:manage', tx);
          requireCondition(
            !input.from || !input.to || input.from <= input.to,
            422,
            'VALIDATION_ERROR',
            'Período inválido',
          );
          let query: Query = this.collection(tenantId, 'visits');
          if (input.customerId) {
            await this.visibleCustomer(tx, ctx, input.customerId);
            query = query.where('customerId', '==', input.customerId);
          }
          if (input.responsibleUid)
            query = query.where('responsibleUid', '==', input.responsibleUid);
          if (input.source) query = query.where('source', '==', input.source);
          if (input.from) query = query.where('visitDate', '>=', input.from);
          if (input.to) query = query.where('visitDate', '<=', input.to);
          query = query.orderBy('visitDate', 'desc').orderBy(FieldPath.documentId(), 'desc');
          // A filtered customer was already checked; otherwise sellers see only the records of
          // customers currently in their portfolio, whoever registered them.
          const portfolio =
            isAdmin(ctx) || input.customerId
              ? null
              : await this.repo.portfolio(tenantId, actor.uid, tx);
          const scope = digest(
            stableJson({
              tenantId,
              actor: actor.uid,
              kind: 'visits',
              input: { ...input, cursor: undefined },
            }),
          );
          const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
          if (cursor) {
            const last = await this.repo.foundation.read(
              this.repo.ref(tenantId, 'visits', cursor),
              s.visitSchema,
              tx,
            );
            requireCondition(
              last?.tenantId === tenantId,
              422,
              'VALIDATION_ERROR',
              'Cursor indisponível',
            );
            query = query.startAfter(last.visitDate, cursor);
          }
          const limit = Number(input.limit ?? '25');
          const batch = portfolio ? Math.max(limit, Math.min(VISIT_SCAN, limit * 4)) : limit;
          const snapshot = await tx.get(query.limit(batch + 1));
          const docs = snapshot.docs.slice(0, batch);
          const visits: s.Visit[] = [];
          let examined = 0;
          for (const doc of docs) {
            examined++;
            const visit = await this.repo.foundation.readSnapshot(doc, s.visitSchema, tx);
            requireCondition(
              visit?.id === doc.id && visit.tenantId === tenantId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            if (!portfolio || portfolio.has(visit.customerId)) visits.push(visit);
            if (visits.length === limit) break;
          }
          const more = examined < docs.length || snapshot.size > batch;
          const [access, customers] = await Promise.all([
            this.orderAccess(
              tx,
              ctx,
              visits.flatMap((v) => (v.orderId ? [v.orderId] : [])),
            ),
            this.customerNames(
              tx,
              tenantId,
              visits.map((v) => v.customerId),
            ),
          ]);
          return {
            visits,
            access,
            customers,
            nextCursor:
              more && examined
                ? encodeCursor(this.repo.secret, scope, docs[examined - 1]!.id)
                : null,
          };
        },
        { readOnly: true },
      ),
    );
    const names = await this.people(page.visits.map((v) => v.responsibleUid));
    return {
      items: page.visits.map((v) =>
        this.view(
          v,
          Boolean(v.orderId && page.access.get(v.orderId)?.accessible),
          names,
          page.customers.get(v.customerId),
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  /** Active membership of the chosen responsible person in this company. */
  private async responsible(tx: Transaction, tenantId: string, uid: string) {
    const [member, identity] = await Promise.all([
      this.repo.foundation.read(
        this.repo.foundation.tenant(tenantId, 'memberships', uid),
        membershipSchema,
        tx,
      ),
      this.repo.foundation.read(this.repo.foundation.global('identities', uid), identitySchema, tx),
    ]);
    requireCondition(
      member?.uid === uid &&
        member.tenantId === tenantId &&
        member.status === 'active' &&
        !member.seatExempt &&
        identity?.status === 'active',
      422,
      'INVALID_RESPONSIBLE',
      'Responsável deve possuir vínculo ativo na empresa',
    );
  }

  /**
   * Manual visit. Never creates orders, stock movements or receivables. The record id derives
   * from the Idempotency-Key, so a retried request returns the same record.
   */
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.visitCreate>, key: string) {
    const id = digest(`visits:${tenantId}:${actor.uid}:${key}`);
    const payloadHash = digest(stableJson(input));
    const now = this.orders.clock();
    const result = await this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'visits:own:manage', tx);
      const ref = this.repo.ref(tenantId, 'visits', id);
      const previous = await this.repo.foundation.read(ref, s.visitSchema, tx);
      if (previous) {
        requireCondition(
          previous.tenantId === tenantId &&
            previous.createdBy === actor.uid &&
            previous.payloadHash === payloadHash,
          409,
          'CONFLICT',
          'Chave de idempotência já utilizada com outro registro',
        );
        const access = await this.orderAccess(tx, ctx, previous.orderId ? [previous.orderId] : []);
        return {
          visit: previous,
          accessible: Boolean(access.get(previous.orderId ?? '')?.accessible),
        };
      }
      requireCondition(
        isAdmin(ctx) || input.responsibleUid === undefined || input.responsibleUid === actor.uid,
        403,
        'FORBIDDEN',
        'Vendedor registra somente as próprias visitas',
      );
      const customer = await this.visibleCustomer(tx, ctx, input.customerId);
      const responsibleUid = input.responsibleUid ?? actor.uid;
      if (responsibleUid !== actor.uid) await this.responsible(tx, tenantId, responsibleUid);
      requireCondition(
        input.visitDate <= localDay(now, ctx.tenant.timezone),
        422,
        'VISIT_DATE_IN_FUTURE',
        'A data da visita não pode estar no futuro',
      );
      let order: { id: string; commercialId: string; accessible: boolean } | null = null;
      if (input.orderId) {
        const related = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'orders', input.orderId),
          orderSchema,
          tx,
        );
        requireCondition(
          related?.id === input.orderId &&
            related.tenantId === tenantId &&
            related.customerId === customer.id,
          422,
          'INVALID_RELATED_ORDER',
          'O pedido relacionado não pertence a este cliente',
        );
        order = {
          id: related.id,
          commercialId: related.commercialId,
          accessible: isAdmin(ctx) || related.sellerUid === actor.uid,
        };
      }
      const createdAt = now.toISOString();
      const visit = s.visitSchema.parse({
        id,
        tenantId,
        customerId: customer.id,
        customerName: customer.name,
        source: 'manual',
        kind: input.kind,
        visitDate: input.visitDate,
        responsibleUid,
        notes: input.notes,
        orderId: order?.id ?? null,
        orderCommercialId: order?.commercialId ?? null,
        createdAt,
        createdBy: actor.uid,
        payloadHash,
        schemaVersion: 1,
      });
      tx.create(ref, visit);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'visits.created', id, createdAt, {
        customerId: customer.id,
        responsibleUid,
        visitDate: visit.visitDate,
        orderId: visit.orderId,
      });
      return { visit, accessible: order?.accessible ?? false };
    });
    const names = await this.people([result.visit.responsibleUid]);
    return this.view(result.visit, result.accessible, names);
  }

  /** Recent orders of one customer, newest confirmation first (projection only). */
  private async customerOrders(
    tx: Transaction,
    tenantId: string,
    customerId: string,
    limit: number,
  ) {
    checkReadBudget();
    const page = await tx.get(
      this.collection(tenantId, 'orders')
        .where('customerId', '==', customerId)
        .orderBy('confirmedAt', 'desc')
        .select('tenantId', 'customerId', 'status', 'confirmedAt', 'commercialId', 'sellerUid')
        .limit(limit + 1),
    );
    const orders = page.docs.slice(0, limit).map((doc) => {
      const facts = purchaseFacts
        .extend({ commercialId: z.string(), sellerUid: opaqueId })
        .safeParse(doc.data());
      requireCondition(
        facts.success && facts.data.tenantId === tenantId && facts.data.customerId === customerId,
        500,
        'INTERNAL_ERROR',
        'Erro interno do servidor',
      );
      return { id: doc.id, ...facts.data };
    });
    return { orders, more: page.size > limit };
  }

  /** Last effectively confirmed delivery of a customer (automatic records only). */
  private async lastDelivery(tx: Transaction, tenantId: string, customerId: string) {
    checkReadBudget();
    const page = await tx.get(
      this.collection(tenantId, 'visits')
        .where('customerId', '==', customerId)
        .where('source', '==', 'automatic')
        .orderBy('visitDate', 'desc')
        .orderBy(FieldPath.documentId(), 'desc')
        .limit(1),
    );
    const doc = page.docs[0];
    if (!doc) return null;
    const visit = await this.repo.foundation.readSnapshot(doc, s.visitSchema, tx);
    requireCondition(
      visit?.tenantId === tenantId,
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    return visit.visitDate;
  }

  /** Last purchase, last delivery and repurchase estimate of one customer. */
  async customerRepurchase(actor: Actor, tenantId: string, customerId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'visits:own:manage', tx);
        await this.visibleCustomer(tx, ctx, customerId);
        const timezone = ctx.tenant.timezone;
        const [{ orders }, lastDeliveryOn] = await Promise.all([
          this.customerOrders(tx, tenantId, customerId, CUSTOMER_ORDER_SCAN),
          this.lastDelivery(tx, tenantId, customerId),
        ]);
        const days = orders.filter(isPurchase).map((o) => localDay(o.confirmedAt!, timezone));
        return s.customerRepurchaseView.parse({
          customerId,
          ...estimateRepurchase(days, localDay(this.orders.clock(), timezone)),
          lastDeliveryOn,
          lookbackDays: REPURCHASE.lookbackDays,
          minimumPurchases: REPURCHASE.minimumPurchases,
        });
      },
      { readOnly: true },
    );
  }

  /**
   * Chronological history of one customer: manual visits, confirmed deliveries and confirmed
   * purchases, newest first. Records of a previous seller stay in the history.
   */
  async timeline(
    actor: Actor,
    tenantId: string,
    customerId: string,
    input: z.infer<typeof s.timelineQuery>,
  ) {
    const limit = Number(input.limit ?? '30');
    const data = await this.repo.foundation.readBudget.run(() =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const ctx = await this.access.tenant(actor, tenantId, 'visits:own:manage', tx);
          await this.visibleCustomer(tx, ctx, customerId);
          checkReadBudget();
          const visitPage = await tx.get(
            this.collection(tenantId, 'visits')
              .where('customerId', '==', customerId)
              .orderBy('visitDate', 'desc')
              .orderBy(FieldPath.documentId(), 'desc')
              .limit(limit + 1),
          );
          const visits: s.Visit[] = [];
          for (const doc of visitPage.docs.slice(0, limit)) {
            const visit = await this.repo.foundation.readSnapshot(doc, s.visitSchema, tx);
            requireCondition(
              visit?.id === doc.id &&
                visit.tenantId === tenantId &&
                visit.customerId === customerId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            visits.push(visit);
          }
          const { orders, more } = await this.customerOrders(tx, tenantId, customerId, limit);
          const purchases = orders.filter(isPurchase);
          const access = await this.orderAccess(tx, ctx, [
            ...visits.flatMap((v) => (v.orderId ? [v.orderId] : [])),
            ...purchases.map((o) => o.id),
          ]);
          return {
            visits,
            purchases,
            access,
            more: visitPage.size > limit || more,
            timezone: ctx.tenant.timezone,
          };
        },
        { readOnly: true },
      ),
    );
    const entries: z.infer<typeof s.timelineEntry>[] = [
      ...data.visits.map((v) => ({
        id: v.id,
        type: v.source === 'automatic' ? ('delivery' as const) : ('visit' as const),
        date: v.visitDate,
        responsibleUid: v.responsibleUid,
        responsibleName: null,
        kind: v.kind,
        notes: v.notes || null,
        order:
          v.orderId && v.orderCommercialId
            ? {
                id: v.orderId,
                commercialId: v.orderCommercialId,
                status: data.access.get(v.orderId)?.status ?? null,
                accessible: Boolean(data.access.get(v.orderId)?.accessible),
              }
            : null,
      })),
      ...data.purchases.map((o) => ({
        id: `purchase-${o.id}`,
        type: 'purchase' as const,
        date: localDay(o.confirmedAt!, data.timezone),
        responsibleUid: o.sellerUid,
        responsibleName: null,
        kind: null,
        notes: null,
        order: {
          id: o.id,
          commercialId: o.commercialId,
          status: o.status,
          accessible: Boolean(data.access.get(o.id)?.accessible),
        },
      })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const items = entries.slice(0, limit);
    const names = await this.people(items.map((e) => e.responsibleUid));
    return s.customerTimelineView.parse({
      customerId,
      items: items.map((e) => ({
        ...e,
        responsibleName: e.responsibleUid ? (names.get(e.responsibleUid) ?? null) : null,
      })),
      hasMore: data.more || entries.length > limit,
    });
  }

  /**
   * Repurchase opportunities of the caller's scope. Purchases come from one bounded scan of
   * confirmed orders inside the lookback window; customers are the active ones in scope.
   */
  async repurchase(actor: Actor, tenantId: string, input: z.infer<typeof s.repurchaseQuery>) {
    const result = await this.gate.run(() =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const ctx = await this.access.tenant(actor, tenantId, 'visits:own:manage', tx);
          requireCondition(
            isAdmin(ctx) || !input.sellerUid || input.sellerUid === actor.uid,
            403,
            'FORBIDDEN',
            'Vendedor consulta somente a própria carteira',
          );
          const timezone = ctx.tenant.timezone;
          const now = this.orders.clock();
          const today = localDay(now, timezone);
          let customersQuery: Query = this.collection(tenantId, 'customers').where(
            'status',
            '==',
            'active',
          );
          const assignee = isAdmin(ctx)
            ? input.sellerUid === 'unassigned'
              ? null
              : input.sellerUid
            : actor.uid;
          if (assignee !== undefined)
            customersQuery = customersQuery.where('assignedTo', '==', assignee);
          checkReadBudget();
          const customerPage = await tx.get(
            customersQuery.select('tenantId', 'name', 'assignedTo').limit(PORTFOLIO_CAP + 1),
          );
          requireCondition(
            customerPage.size <= PORTFOLIO_CAP,
            422,
            'REPURCHASE_TOO_LARGE',
            `A consulta passa de ${PORTFOLIO_CAP} clientes. Filtre por vendedor.`,
          );
          // One day of slack covers any timezone offset; the estimate filters by local day.
          const since = new Date(
            Date.parse(`${shiftDate(today, -REPURCHASE.lookbackDays - 1)}T00:00:00Z`),
          ).toISOString();
          checkReadBudget();
          const orderPage = await tx.get(
            this.collection(tenantId, 'orders')
              .where('confirmedAt', '>=', since)
              .select('tenantId', 'customerId', 'status', 'confirmedAt')
              .limit(REPURCHASE_ORDER_CAP + 1),
          );
          requireCondition(
            orderPage.size <= REPURCHASE_ORDER_CAP,
            422,
            'REPURCHASE_TOO_LARGE',
            `O último ano passa de ${REPURCHASE_ORDER_CAP} pedidos para esta consulta.`,
          );
          const days = new Map<string, string[]>();
          for (const doc of orderPage.docs) {
            const facts = purchaseFacts.safeParse(doc.data());
            requireCondition(
              facts.success && facts.data.tenantId === tenantId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            if (!isPurchase(facts.data) || facts.data.customerId === null) continue;
            const list = days.get(facts.data.customerId) ?? [];
            list.push(localDay(facts.data.confirmedAt!, timezone));
            days.set(facts.data.customerId, list);
          }
          const search = input.q ? searchKey(input.q) : null;
          const rows = customerPage.docs
            .map((doc) => {
              const name: unknown = doc.get('name');
              const assignedTo: unknown = doc.get('assignedTo');
              requireCondition(
                doc.get('tenantId') === tenantId && typeof name === 'string',
                500,
                'INTERNAL_ERROR',
                'Erro interno do servidor',
              );
              return {
                customerId: doc.id,
                customerName: name,
                sellerUid: typeof assignedTo === 'string' ? assignedTo : null,
                ...estimateRepurchase(days.get(doc.id) ?? [], today),
              };
            })
            .filter((row) => !search || searchKey(row.customerName).includes(search));
          const totals = { insufficient_history: 0, on_track: 0, overdue: 0 };
          for (const row of rows) totals[row.status]++;
          const listed = rows
            .filter((row) => !input.status || row.status === input.status)
            .sort(compareRepurchase);
          const scope = digest(
            stableJson({
              tenantId,
              actor: actor.uid,
              kind: 'repurchase',
              input: { ...input, cursor: undefined },
            }),
          );
          const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
          const start = cursor ? listed.findIndex((row) => row.customerId === cursor) + 1 : 0;
          requireCondition(!cursor || start > 0, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
          const limit = Number(input.limit ?? '25');
          const items = listed.slice(start, start + limit);
          return {
            items,
            totals,
            nextCursor:
              start + limit < listed.length && items.length
                ? encodeCursor(this.repo.secret, scope, items[items.length - 1]!.customerId)
                : null,
            generatedAt: now.toISOString(),
          };
        },
        { readOnly: true },
      ),
    );
    const names = await this.people(result.items.map((row) => row.sellerUid));
    return s.repurchasePage.parse({
      ...result,
      items: result.items.map((row) => ({
        ...row,
        sellerName: row.sellerUid ? (names.get(row.sellerUid) ?? null) : null,
      })),
      lookbackDays: REPURCHASE.lookbackDays,
      minimumPurchases: REPURCHASE.minimumPurchases,
    });
  }
}
