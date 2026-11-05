import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import * as s from '../../shared/schemas/commercial.js';
import { identitySchema, membershipSchema } from '../../shared/schemas/models.js';
import { requirePermission } from '../users/permissions.js';
import type { TenantContext } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';

export class CustomerService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {}
  async read(actor: Actor, tenantId: string, id: string, tx?: Transaction) {
    const ctx = await this.access.tenant(actor, tenantId, 'customers:own:manage', tx);
    const customer = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customers', id),
      s.customerSchema,
      tx,
    );
    requireCondition(
      customer?.tenantId === tenantId &&
        customer.id === id &&
        (ctx.membership.role === 'administrator' || customer.assignedTo === actor.uid),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return customer;
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.customerQuery>) {
    const ctx = await this.access.tenant(actor, tenantId, 'customers:own:manage');
    const relationship = input.relationship ?? 'customer';
    if (relationship !== 'customer')
      requirePermission(ctx.membership, ctx.entitlements, 'suppliers:manage');
    // Suppliers belong to the company, not to a seller's portfolio: there is no index for this.
    requireCondition(
      relationship !== 'supplier' || input.assignedTo === undefined,
      422,
      'VALIDATION_ERROR',
      'Fornecedores não têm responsável',
    );
    if (input.document) return this.findByDocument(actor, tenantId, input, ctx.membership.role);
    const seller = ctx.membership.role === 'seller';
    if (relationship !== 'customer')
      return this.repo.list(actor, tenantId, 'customers', s.customerSchema, input, seller);
    // Supplier-only records live in the same collection and are rare among customers. Old records
    // have no relationship field to query, so they are filtered here over a bounded page scan and
    // the underlying cursor is preserved, as the inventory list does for sparse filters.
    const items: s.Customer[] = [];
    let cursor = input.cursor;
    for (let scanned = 0; scanned < 5; scanned++) {
      const page = await this.repo.list(
        actor,
        tenantId,
        'customers',
        s.customerSchema,
        { ...input, ...(cursor ? { cursor } : {}) },
        seller,
      );
      items.push(...page.items.filter((customer) => customer.relationships.includes('customer')));
      cursor = page.nextCursor ?? undefined;
      if (items.length > 0 || !cursor) break;
    }
    return { items, nextCursor: cursor ?? null };
  }
  /**
   * Picker of the company's active suppliers. Read through `purchases:read` so a purchaser needs
   * no access to the customer base; only identification fields leave the service.
   */
  async suppliers(actor: Actor, tenantId: string, input: z.infer<typeof s.supplierOptionsQuery>) {
    await this.access.tenant(actor, tenantId, 'purchases:read');
    return this.repo.list(
      actor,
      tenantId,
      'customers',
      s.customerSchema,
      { ...input, status: 'active', relationship: 'supplier' },
      false,
    );
  }
  /** Same visibility as the list: sellers only see their own portfolio, status filter applies. */
  private async findByDocument(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.customerQuery>,
    role: string,
  ) {
    const empty = { items: [], nextCursor: null };
    const reservation = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customerDocuments', digest(input.document!)),
      s.reservationSchema,
    );
    if (!reservation) return empty;
    const customer = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'customers', reservation.resourceId),
      s.customerSchema,
    );
    const status = input.status ?? 'active';
    const assignedTo = input.assignedTo === 'unassigned' ? null : input.assignedTo;
    const visible =
      customer?.tenantId === tenantId &&
      customer.document === input.document &&
      (role === 'administrator' || customer.assignedTo === actor.uid) &&
      (status === 'all' || customer.status === status) &&
      (input.assignedTo === undefined || customer.assignedTo === assignedTo) &&
      (input.relationship === 'all' ||
        customer.relationships.includes(input.relationship ?? 'customer'));
    return visible ? { items: [customer], nextCursor: null } : empty;
  }
  private async assignee(tenantId: string, uid: string | null, tx: Transaction) {
    if (!uid) return;
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
        member.role === 'seller' &&
        identity?.status === 'active',
      422,
      'INVALID_ASSIGNEE',
      'Vendedor responsável indisponível nesta empresa',
    );
  }
  /** Changing who a record is, or creating a supplier, depends on the plan and the permission. */
  private guardRelationships(
    ctx: TenantContext,
    previous: readonly s.Relationship[],
    next: readonly s.Relationship[],
  ) {
    const changed =
      previous.includes('supplier') !== next.includes('supplier') ||
      previous.includes('customer') !== next.includes('customer');
    if (changed && (previous.length > 0 || next.includes('supplier')))
      requirePermission(ctx.membership, ctx.entitlements, 'suppliers:manage');
  }
  /** History keeps a relationship alive: orders need a customer, purchases a supplier. */
  private async guardRemoval(
    tenantId: string,
    id: string,
    previous: readonly s.Relationship[],
    next: readonly s.Relationship[],
    tx: Transaction,
  ) {
    const lost = (name: s.Relationship) => previous.includes(name) && !next.includes(name);
    const used = async (collection: 'orders' | 'purchases', field: string) =>
      !(
        await tx.get(
          this.repo.ref(tenantId, collection, 'placeholder').parent.where(field, '==', id).limit(1),
        )
      ).empty;
    requireCondition(
      !(lost('customer') && (await used('orders', 'customerId'))),
      409,
      'RELATIONSHIP_IN_USE',
      'Este cadastro tem pedidos e continua sendo cliente',
    );
    requireCondition(
      !(lost('supplier') && (await used('purchases', 'supplierId'))),
      409,
      'RELATIONSHIP_IN_USE',
      'Este cadastro tem compras e continua sendo fornecedor',
    );
  }
  private async reserve(
    tenantId: string,
    id: string,
    previous: string | null,
    next: string | null,
    tx: Transaction,
  ) {
    if (previous === next) return;
    if (next) {
      const ref = this.repo.ref(tenantId, 'customerDocuments', digest(next));
      const reservation = await this.repo.foundation.read(ref, s.reservationSchema, tx);
      requireCondition(
        !reservation || reservation.resourceId === id,
        409,
        'DUPLICATE_DOCUMENT',
        'Documento já cadastrado nesta empresa',
      );
    }
    // All transaction reads must precede writes; caller applies reservations after this check.
  }
  private writeReservation(
    tenantId: string,
    id: string,
    previous: string | null,
    next: string | null,
    tx: Transaction,
  ) {
    if (previous === next) return;
    if (previous) tx.delete(this.repo.ref(tenantId, 'customerDocuments', digest(previous)));
    if (next)
      tx.set(this.repo.ref(tenantId, 'customerDocuments', digest(next)), {
        resourceId: id,
        schemaVersion: 1,
      });
  }
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.customerCreate>) {
    const id = randomUUID();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, 'customers:own:manage', tx);
      const seller = ctx.membership.role === 'seller';
      requireCondition(
        !seller || !Object.hasOwn(input, 'assignedTo'),
        403,
        'FORBIDDEN',
        'Responsável é definido pelo servidor',
      );
      const relationships = input.relationships ?? (['customer'] as s.Relationship[]);
      this.guardRelationships(ctx, [], relationships);
      const assignedTo = seller ? actor.uid : (input.assignedTo ?? null);
      requireCondition(
        relationships.includes('customer') || assignedTo === null,
        422,
        'VALIDATION_ERROR',
        'Fornecedor não tem vendedor responsável',
      );
      await this.assignee(tenantId, assignedTo, tx);
      await this.reserve(tenantId, id, null, input.document ?? null, tx);
      const now = this.clock().toISOString();
      const customer = s.customerSchema.parse({
        ...input,
        id,
        tenantId,
        nameKey: s.searchKey(input.name),
        tradeName: input.tradeName ?? null,
        contactName: input.contactName ?? null,
        relationships,
        isSupplier: relationships.includes('supplier'),
        document: input.document ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        assignedTo,
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      this.writeReservation(tenantId, id, null, customer.document, tx);
      tx.create(this.repo.ref(tenantId, 'customers', id), customer);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'customer.created', id, now, {
        assignedTo,
      });
      return customer;
    });
  }
  async update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.customerUpdate>,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const customer = await this.read(actor, tenantId, id, tx);
      const ctx = await this.access.tenant(actor, tenantId, 'customers:own:manage', tx);
      if (Object.hasOwn(input, 'status'))
        await this.access.tenant(actor, tenantId, 'customers:all:manage', tx);
      const relationships = input.relationships ?? customer.relationships;
      this.guardRelationships(ctx, customer.relationships, relationships);
      requireCondition(
        relationships.includes('customer') || customer.assignedTo === null,
        409,
        'RELATIONSHIP_IN_USE',
        'Retire o vendedor responsável antes de deixar de ser cliente',
      );
      requireCondition(
        customer.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const { expectedVersion: _version, ...changes } = input;
      await this.guardRemoval(tenantId, id, customer.relationships, relationships, tx);
      await this.reserve(
        tenantId,
        id,
        customer.document,
        input.document === undefined ? customer.document : input.document,
        tx,
      );
      const now = this.clock().toISOString();
      const next = s.customerSchema.parse({
        ...customer,
        ...changes,
        nameKey: s.searchKey(input.name ?? customer.name),
        relationships,
        isSupplier: relationships.includes('supplier'),
        version: customer.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      this.writeReservation(tenantId, id, customer.document, next.document, tx);
      tx.set(this.repo.ref(tenantId, 'customers', id), next);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'customer.updated', id, now, {
        fields: Object.keys(changes),
      });
      return next;
    });
  }
  async assign(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.assignmentInput>,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'customers:all:manage', tx);
      const customer = await this.read(actor, tenantId, id, tx);
      requireCondition(
        customer.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      requireCondition(
        customer.relationships.includes('customer') || input.assignedTo === null,
        422,
        'VALIDATION_ERROR',
        'Fornecedor não tem vendedor responsável',
      );
      await this.assignee(tenantId, input.assignedTo, tx);
      const now = this.clock().toISOString();
      const next = s.customerSchema.parse({
        ...customer,
        assignedTo: input.assignedTo,
        version: customer.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      tx.set(this.repo.ref(tenantId, 'customers', id), next);
      recordAudit(
        this.repo.foundation,
        tx,
        actor,
        tenantId,
        'customer.assignment.changed',
        id,
        now,
        { previousAssignee: customer.assignedTo, assignedTo: next.assignedTo },
      );
      return next;
    });
  }
}
