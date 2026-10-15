import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import * as s from '../../shared/schemas/commercial.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { digest } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { stockSchema } from '../../shared/schemas/inventory.js';
import { projectStock } from '../inventory/stockProjection.js';
import { parseQuantity, formatQuantity } from '../inventory/quantities.js';

export class ProductService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {}
  async read(actor: Actor, tenantId: string, id: string, tx?: Transaction, managing = false) {
    const ctx = await this.access.tenant(
      actor,
      tenantId,
      managing ? 'products:manage' : 'products:read',
      tx,
    );
    const product = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'products', id),
      s.productSchema,
      tx,
    );
    requireCondition(
      product?.tenantId === tenantId &&
        product.id === id &&
        (ctx.membership.role === 'administrator' || product.status === 'active'),
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return product;
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.productQuery>) {
    const ctx = await this.access.tenant(actor, tenantId, 'products:read');
    return this.repo.list(
      actor,
      tenantId,
      'products',
      s.productSchema,
      input,
      ctx.membership.role === 'seller',
    );
  }
  private async category(tenantId: string, id: string | null, tx: Transaction) {
    if (!id) return;
    const category = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'categories', id),
      s.categorySchema,
      tx,
    );
    requireCondition(
      category?.id === id && category.tenantId === tenantId && category.status === 'active',
      422,
      'INVALID_CATEGORY',
      'Categoria indisponível nesta empresa',
    );
  }
  private async reserve(tenantId: string, id: string, sku: string, tx: Transaction) {
    const reservation = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'productSkus', digest(sku)),
      s.reservationSchema,
      tx,
    );
    requireCondition(
      !reservation || reservation.resourceId === id,
      409,
      'DUPLICATE_SKU',
      'SKU já cadastrado nesta empresa',
    );
  }
  async create(actor: Actor, tenantId: string, input: z.infer<typeof s.productCreate>) {
    const id = randomUUID();
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'products:manage', tx);
      await this.category(tenantId, input.categoryId ?? null, tx);
      await this.reserve(tenantId, id, input.sku, tx);
      const now = this.clock().toISOString();
      const product = s.productSchema.parse({
        ...input,
        id,
        tenantId,
        description: input.description ?? '',
        categoryId: input.categoryId ?? null,
        nameKey: s.searchKey(input.name),
        quantityPrecision: s.quantityPrecision(input.unit),
        catalogVisible: input.catalogVisible ?? false,
        minimumStock: formatQuantity(parseQuantity(input.minimumStock ?? '0', input.unit)),
        image: null,
        status: 'active',
        version: 1,
        createdBy: actor.uid,
        updatedBy: actor.uid,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(this.repo.ref(tenantId, 'products', id), product);
      tx.create(this.repo.ref(tenantId, 'inventory', id), projectStock(product, null));
      tx.set(this.repo.ref(tenantId, 'productSkus', digest(product.sku)), {
        resourceId: id,
        schemaVersion: 1,
      });
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'product.created', id, now, {
        priceCents: product.priceCents,
      });
      return product;
    });
  }
  async update(actor: Actor, tenantId: string, id: string, input: z.infer<typeof s.productUpdate>) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const product = await this.read(actor, tenantId, id, tx, true);
      requireCondition(
        product.version === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      if (input.categoryId !== undefined && input.categoryId !== product.categoryId)
        await this.category(tenantId, input.categoryId, tx);
      if (input.sku !== undefined && input.sku !== product.sku)
        await this.reserve(tenantId, id, input.sku, tx);
      const stock = await this.repo.foundation.read(
        this.repo.ref(tenantId, 'inventory', id),
        stockSchema,
        tx,
      );
      requireCondition(
        !stock || (stock.id === id && stock.tenantId === tenantId && stock.unit === product.unit),
        500,
        'INTERNAL_ERROR',
        'Erro interno do servidor',
      );
      if (input.unit && input.unit !== product.unit) {
        requireCondition(
          !stock ||
            (stock.movementCount === 0 && stock.physicalScaled === 0 && stock.reservedScaled === 0),
          409,
          'UNIT_LOCKED',
          'Unidade vinculada ao histórico de estoque',
        );
      }
      const { expectedVersion: _version, ...changes } = input;
      const now = this.clock().toISOString();
      const next = s.productSchema.parse({
        ...product,
        ...changes,
        nameKey: s.searchKey(input.name ?? product.name),
        quantityPrecision: s.quantityPrecision(input.unit ?? product.unit),
        minimumStock: formatQuantity(
          parseQuantity(input.minimumStock ?? product.minimumStock, input.unit ?? product.unit),
        ),
        version: product.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      if (next.sku !== product.sku) {
        tx.delete(this.repo.ref(tenantId, 'productSkus', digest(product.sku)));
        tx.set(this.repo.ref(tenantId, 'productSkus', digest(next.sku)), {
          resourceId: id,
          schemaVersion: 1,
        });
      }
      tx.set(this.repo.ref(tenantId, 'products', id), next);
      const projection = projectStock(next, stock, now);
      if (stock && (next.unit !== product.unit || next.minimumStock !== product.minimumStock))
        projection.version++;
      tx.set(this.repo.ref(tenantId, 'inventory', id), projection);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'product.updated', id, now, {
        fields: Object.keys(changes),
        ...(input.priceCents !== undefined
          ? { previousPriceCents: product.priceCents, priceCents: next.priceCents }
          : {}),
      });
      return next;
    });
  }
}
