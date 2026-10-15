import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import * as s from '../../shared/schemas/commercial.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
export class CategoryService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {}
  async read(actor: Actor, tenantId: string, id: string) {
    await this.access.tenant(actor, tenantId, 'products:read');
    const category = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'categories', id),
      s.categorySchema,
    );
    requireCondition(
      category?.tenantId === tenantId && category.id === id,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return category;
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.categoryQuery>) {
    await this.access.tenant(actor, tenantId, 'products:read');
    return this.repo.list(actor, tenantId, 'categories', s.categorySchema, input, false);
  }
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.categoryCreate>) {
    const id = randomUUID();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'products:manage', tx);
      const now = this.clock().toISOString();
      const category = s.categorySchema.parse({
        ...input,
        id,
        tenantId,
        nameKey: s.searchKey(input.name),
        description: input.description ?? '',
        status: 'active',
        version: 1,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.repo.ref(tenantId, 'categories', id), category);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'category.created', id, now, {});
      return category;
    });
  }
  async update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.categoryUpdate>,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'products:manage', tx);
      const category = await this.repo.foundation.read(
        this.repo.ref(tenantId, 'categories', id),
        s.categorySchema,
        tx,
      );
      requireCondition(
        category?.tenantId === tenantId && category.id === id,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(
        category.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const { expectedVersion: _version, ...changes } = input;
      const now = this.clock().toISOString();
      const next = s.categorySchema.parse({
        ...category,
        ...changes,
        nameKey: s.searchKey(input.name ?? category.name),
        version: category.version + 1,
        updatedBy: actor.uid,
        updatedAt: now,
      });
      tx.set(this.repo.ref(tenantId, 'categories', id), next);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'category.updated', id, now, {
        fields: Object.keys(changes),
      });
      return next;
    });
  }
}
