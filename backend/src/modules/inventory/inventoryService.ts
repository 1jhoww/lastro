import { randomUUID } from 'node:crypto';
import { FieldPath, type Query, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { AccessService } from '../auth/accessService.js';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import { productSchema, type Product, searchKey } from '../../shared/schemas/commercial.js';
import * as s from '../../shared/schemas/inventory.js';
import { requireCondition, AppError } from '../../shared/errors/appError.js';
import { digest, stableJson, encodeCursor, decodeCursor } from '../../shared/utils/crypto.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { parseQuantity, formatQuantity, transition } from './quantities.js';
import { projectStock } from './stockProjection.js';
import { readCheckpoint, signCheckpoint } from './reconciliationCursor.js';

const operationSchema = z.strictObject({
  actorUid: z.string(),
  payloadHash: z.string(),
  movementId: z.string(),
  stockAfter: s.stockAdminView,
  createdAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
});
export const stockView = (stock: s.Stock) =>
  s.stockAdminView.parse({
    productId: stock.id,
    name: stock.name,
    sku: stock.sku,
    unit: stock.unit,
    status: stock.status,
    physical: formatQuantity(stock.physicalScaled),
    reserved: formatQuantity(stock.reservedScaled),
    available: formatQuantity(stock.physicalScaled - stock.reservedScaled),
    minimumStock: formatQuantity(stock.minimumScaled),
    suggestedQuantity: formatQuantity(stock.shortfallScaled),
    version: stock.version,
    lastMovementAt: stock.lastMovementAt,
  });
export const movementView = (movement: s.Movement) =>
  s.movementView.parse({
    ...movement,
    quantity: formatQuantity(movement.quantityScaled),
    previousPhysical: formatQuantity(movement.previousPhysicalScaled),
    physical: formatQuantity(movement.physicalScaled),
    previousReserved: formatQuantity(movement.previousReservedScaled),
    reserved: formatQuantity(movement.reservedScaled),
  });
export function movementHash(movement: Omit<s.Movement, 'hash'>): string {
  return digest(stableJson(movement));
}

export class InventoryService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly clock: () => Date,
  ) {}
  private async load(tenantId: string, productId: string, tx: Transaction) {
    const product = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'products', productId),
      productSchema,
      tx,
    );
    requireCondition(
      product?.id === productId && product.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return { product, stock: await this.stockFor(product, tx) };
  }
  async stockFor(product: Product, tx: Transaction) {
    const stored = await this.repo.foundation.read(
      this.repo.ref(product.tenantId, 'inventory', product.id),
      s.stockSchema,
      tx,
    );
    requireCondition(
      !stored ||
        (stored.id === product.id &&
          stored.tenantId === product.tenantId &&
          stored.unit === product.unit &&
          stored.name === product.name &&
          stored.nameKey === product.nameKey &&
          stored.sku === product.sku &&
          stored.status === product.status &&
          stored.categoryId === product.categoryId &&
          stored.minimumScaled === parseQuantity(product.minimumStock, product.unit)),
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    return stored ?? projectStock(product, null);
  }
  async get(actor: Actor, tenantId: string, productId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'inventory:available:read', tx);
        const { product, stock } = await this.load(tenantId, productId, tx);
        requireCondition(
          ctx.membership.role === 'administrator' || product.status === 'active',
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        return ctx.membership.role === 'administrator'
          ? stockView(stock)
          : s.availabilityView.parse(stockView(stock));
      },
      { readOnly: true },
    );
  }
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.inventoryQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.access.tenant(actor, tenantId, 'inventory:available:read', tx);
        const page = await this.repo.list(
          actor,
          tenantId,
          'products',
          productSchema,
          input,
          ctx.membership.role === 'seller',
          tx,
        );
        const items = await Promise.all(
          page.items.map(async (product) => {
            const stock = stockView(await this.stockFor(product, tx));
            return ctx.membership.role === 'administrator'
              ? stock
              : s.availabilityView.parse(stock);
          }),
        );
        return { items, nextCursor: page.nextCursor };
      },
      { readOnly: true },
    );
  }
  async entry(actor: Actor, tenantId: string, input: z.infer<typeof s.entryInput>, key: string) {
    return this.move(actor, tenantId, input, key, false);
  }
  async adjust(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.adjustmentInput>,
    key: string,
  ) {
    return this.move(actor, tenantId, input, key, true);
  }
  private async move(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.entryInput> | z.infer<typeof s.adjustmentInput>,
    key: string,
    adjusting: boolean,
  ) {
    z.string().uuid().parse(key);
    const movementId = randomUUID();
    const operationId = digest(`inventory:${key}`);
    const payloadHash = digest(stableJson({ adjusting, ...input }));
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'inventory:manage', tx);
      const operationRef = this.repo.ref(tenantId, 'stockOperations', operationId);
      const existing = await this.repo.foundation.read(operationRef, operationSchema, tx);
      requireCondition(
        !existing || (existing.actorUid === actor.uid && existing.payloadHash === payloadHash),
        409,
        'CONFLICT',
        'Chave de idempotência já utilizada com outro comando',
      );
      if (existing) {
        const movement = await this.repo.foundation.read(
          this.repo.ref(tenantId, 'inventoryMovements', existing.movementId),
          s.movementSchema,
          tx,
        );
        requireCondition(
          movement?.tenantId === tenantId && movement.operationId === operationId,
          409,
          'CONFLICT',
          'Resultado indisponível',
        );
        return { movement: movementView(movement), stock: existing.stockAfter };
      }
      const { product, stock } = await this.load(tenantId, input.productId, tx);
      const delta = parseQuantity(
        'delta' in input ? input.delta : input.quantity,
        product.unit,
        adjusting,
      );
      requireCondition(
        delta !== 0,
        422,
        'INVALID_QUANTITY',
        'Movimentação exige quantidade diferente de zero',
      );
      if ('expectedVersion' in input)
        requireCondition(
          stock.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão de estoque desatualizada',
        );
      const type: s.Movement['type'] = adjusting
        ? delta > 0
          ? 'STOCK_ADJUSTMENT_IN'
          : 'STOCK_ADJUSTMENT_OUT'
        : 'STOCK_ENTRY';
      const balances = transition(
        stock.physicalScaled,
        stock.reservedScaled,
        type,
        Math.abs(delta),
      );
      const now = this.clock().toISOString();
      const content = {
        id: movementId,
        tenantId,
        productId: product.id,
        type,
        unit: product.unit,
        quantityScaled: Math.abs(delta),
        previousPhysicalScaled: stock.physicalScaled,
        ...balances,
        previousReservedScaled: stock.reservedScaled,
        sequence: stock.movementCount + 1,
        origin: 'administrative' as const,
        originReference: key,
        actorUid: actor.uid,
        reason: input.reason,
        notes: input.notes ?? null,
        occurredAt: now,
        requestId: actor.requestId,
        operationId,
        previousHash: stock.lastMovementHash,
        schemaVersion: 1 as const,
      };
      const movement = s.movementSchema.parse({ ...content, hash: movementHash(content) });
      const next = projectStock(
        product,
        {
          ...stock,
          ...balances,
          version: stock.version + 1,
          movementCount: movement.sequence,
          lastMovementId: movement.id,
          lastMovementAt: now,
          lastMovementHash: movement.hash,
        },
        now,
      );
      tx.set(this.repo.ref(tenantId, 'inventory', product.id), next);
      tx.create(this.repo.ref(tenantId, 'inventoryMovements', movementId), movement);
      tx.create(operationRef, {
        actorUid: actor.uid,
        payloadHash,
        movementId,
        stockAfter: stockView(next),
        createdAt: now,
        schemaVersion: 1,
      });
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'inventory.moved', product.id, now, {
        movementId,
        type,
        quantityScaled: movement.quantityScaled,
        previousPhysicalScaled: stock.physicalScaled,
        physicalScaled: next.physicalScaled,
        reservedScaled: next.reservedScaled,
      });
      return { movement: movementView(movement), stock: stockView(next) };
    });
  }
  private scope(actor: Actor, tenantId: string, collection: string, input: unknown) {
    return digest(stableJson({ actor: actor.uid, tenantId, collection, input }));
  }
  async movements(actor: Actor, tenantId: string, input: z.infer<typeof s.movementQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'inventory:manage', tx);
        requireCondition(
          !input.from || !input.to || input.from <= input.to,
          422,
          'VALIDATION_ERROR',
          'Período inválido',
        );
        if (input.productId) await this.load(tenantId, input.productId, tx);
        let query: Query = this.repo.ref(tenantId, 'inventoryMovements', 'placeholder').parent;
        if (input.productId) query = query.where('productId', '==', input.productId);
        if (input.type) query = query.where('type', '==', input.type);
        if (input.from) query = query.where('occurredAt', '>=', input.from);
        if (input.to) query = query.where('occurredAt', '<=', input.to);
        const direction = input.direction ?? 'desc';
        query = query.orderBy('occurredAt', direction).orderBy(FieldPath.documentId(), direction);
        const scope = this.scope(actor, tenantId, 'movements', { ...input, cursor: undefined });
        const cursorId = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursorId) {
          const cursor = await tx.get(this.repo.ref(tenantId, 'inventoryMovements', cursorId));
          requireCondition(cursor.exists, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
          query = query.startAfter(cursor);
        }
        const limit = Number(input.limit ?? '25');
        const page = await tx.get(query.limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        const items = docs.map((doc) => {
          const parsed = s.movementSchema.safeParse(doc.data());
          if (!parsed.success)
            throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
          const movement = parsed.data;
          requireCondition(
            movement.id === doc.id && movement.tenantId === tenantId,
            500,
            'INTERNAL_ERROR',
            'Erro interno do servidor',
          );
          return movementView(movement);
        });
        return {
          items,
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  async replenishment(actor: Actor, tenantId: string, input: z.infer<typeof s.replenishmentQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'inventory:manage', tx);
        const sort = input.sort ?? 'name';
        const direction = input.direction ?? 'asc';
        requireCondition(
          !input.q || (sort === 'name' && direction === 'asc'),
          422,
          'VALIDATION_ERROR',
          'Busca exige name asc',
        );
        let query: Query = this.repo
          .ref(tenantId, 'inventory', 'placeholder')
          .parent.where('belowMinimum', '==', true);
        if ((input.status ?? 'active') !== 'all')
          query = query.where('status', '==', input.status ?? 'active');
        if (input.categoryId) query = query.where('categoryId', '==', input.categoryId);
        if (input.q) {
          const prefix = searchKey(input.q);
          query = query.where('nameKey', '>=', prefix).where('nameKey', '<=', prefix + '\uf8ff');
        }
        query = query
          .orderBy(sort === 'name' ? 'nameKey' : 'shortfallScaled', direction)
          .orderBy(FieldPath.documentId(), direction);
        const scope = this.scope(actor, tenantId, 'replenishment', { ...input, cursor: undefined });
        const cursorId = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursorId) {
          const cursor = await tx.get(this.repo.ref(tenantId, 'inventory', cursorId));
          requireCondition(cursor.exists, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
          query = query.startAfter(cursor);
        }
        const limit = Number(input.limit ?? '25');
        const page = await tx.get(query.limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        const items = docs.map((doc) => {
          const stock = s.stockSchema.parse(doc.data());
          requireCondition(
            stock.id === doc.id && stock.tenantId === tenantId,
            500,
            'INTERNAL_ERROR',
            'Erro interno do servidor',
          );
          return stockView(stock);
        });
        return {
          items,
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  async reconcile(
    actor: Actor,
    tenantId: string,
    productId: string,
    input: z.infer<typeof import('../../shared/schemas/http.js').pageQuery>,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'inventory:manage', tx);
        const { stock } = await this.load(tenantId, productId, tx);
        const scope = this.scope(actor, tenantId, 'reconciliation', { productId });
        const checkpoint = input.cursor
          ? readCheckpoint(this.repo.secret, input.cursor, scope)
          : {
              scope,
              version: stock.version,
              sequence: 0,
              checked: 0,
              lastId: null,
              physical: 0,
              reserved: 0,
              previousHash: null,
              consistent: true,
            };
        requireCondition(
          checkpoint.version === stock.version,
          409,
          'CONFLICT',
          'Estoque mudou; reinicie a reconciliação',
        );
        const limit = Number(input.limit ?? '25');
        let query: Query = this.repo
          .ref(tenantId, 'inventoryMovements', 'placeholder')
          .parent.where('productId', '==', productId)
          .orderBy('sequence')
          .orderBy(FieldPath.documentId());
        if (checkpoint.lastId) query = query.startAfter(checkpoint.sequence, checkpoint.lastId);
        query = query.limit(limit + 1);
        const page = await tx.get(query);
        const docs = page.docs.slice(0, limit);
        for (const doc of docs) {
          const parsed = s.movementSchema.safeParse(doc.data());
          if (!parsed.success)
            throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
          const { hash, ...content } = parsed.data;
          const movement = parsed.data;
          let arithmetic: boolean;
          try {
            const result = transition(
              checkpoint.physical,
              checkpoint.reserved,
              movement.type,
              movement.quantityScaled,
            );
            arithmetic =
              result.physicalScaled === movement.physicalScaled &&
              result.reservedScaled === movement.reservedScaled;
          } catch {
            arithmetic = false;
          }
          checkpoint.consistent &&=
            arithmetic &&
            movement.id === doc.id &&
            movement.tenantId === tenantId &&
            movement.productId === productId &&
            movement.unit === stock.unit &&
            movement.sequence === checkpoint.sequence + 1 &&
            movement.previousPhysicalScaled === checkpoint.physical &&
            movement.previousReservedScaled === checkpoint.reserved &&
            movement.previousHash === checkpoint.previousHash &&
            hash === movementHash(content);
          checkpoint.sequence = movement.sequence;
          checkpoint.checked++;
          checkpoint.lastId = doc.id;
          checkpoint.physical = movement.physicalScaled;
          checkpoint.reserved = movement.reservedScaled;
          checkpoint.previousHash = hash;
        }
        const complete = page.size <= limit;
        if (complete)
          checkpoint.consistent &&=
            checkpoint.sequence === stock.movementCount &&
            checkpoint.checked === stock.movementCount &&
            checkpoint.lastId === stock.lastMovementId &&
            checkpoint.physical === stock.physicalScaled &&
            checkpoint.reserved === stock.reservedScaled &&
            checkpoint.previousHash === stock.lastMovementHash;
        return {
          productId,
          stockVersion: stock.version,
          checkedMovements: checkpoint.checked,
          complete,
          consistent: checkpoint.consistent,
          physical: formatQuantity(checkpoint.physical),
          reserved: formatQuantity(checkpoint.reserved),
          nextCursor: complete ? null : signCheckpoint(this.repo.secret, checkpoint),
        };
      },
      { readOnly: true },
    );
  }
}
