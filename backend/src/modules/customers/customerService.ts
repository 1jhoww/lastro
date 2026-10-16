import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import * as s from '../../shared/schemas/commercial.js';
import { identitySchema, membershipSchema } from '../../shared/schemas/models.js';
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
    if (input.document) return this.findByDocument(actor, tenantId, input, ctx.membership.role);
    return this.repo.list(
      actor,
      tenantId,
      'customers',
      s.customerSchema,
      input,
      ctx.membership.role === 'seller',
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
      (input.assignedTo === undefined || customer.assignedTo === assignedTo);
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
      const assignedTo = seller ? actor.uid : (input.assignedTo ?? null);
      await this.assignee(tenantId, assignedTo, tx);
      await this.reserve(tenantId, id, null, input.document ?? null, tx);
      const now = this.clock().toISOString();
      const customer = s.customerSchema.parse({
        ...input,
        id,
        tenantId,
        nameKey: s.searchKey(input.name),
        tradeName: input.tradeName ?? null,
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
      if (Object.hasOwn(input, 'status'))
        await this.access.tenant(actor, tenantId, 'customers:all:manage', tx);
      requireCondition(
        customer.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const { expectedVersion: _version, ...changes } = input;
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
