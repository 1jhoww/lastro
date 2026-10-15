import {
  FieldPath,
  type Query,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { FoundationRepository } from './foundationRepository.js';
import type { Actor } from '../../shared/types/context.js';
import { opaqueId } from '../../shared/schemas/models.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import { decodeCursor, encodeCursor, digest, stableJson } from '../../shared/utils/crypto.js';
import { searchKey, type CommercialQuery } from '../../shared/schemas/commercial.js';
export type CommercialCollection =
  | 'customers'
  | 'products'
  | 'categories'
  | 'customerDocuments'
  | 'productSkus'
  | 'inventory'
  | 'inventoryMovements'
  | 'stockOperations'
  | 'orders'
  | 'orderEvents'
  | 'orderOperations'
  | 'stockReservations'
  | 'receivables'
  | 'orderFinancialGuards'
  | 'payments'
  | 'paymentConditions'
  | 'paymentMethods'
  | 'paymentSettingNames'
  | 'financialOperations'
  | 'financialTitles'
  | 'financialOrderStates'
  | 'financialEvents'
  | 'financialExecutions'
  | 'financialExecutionPlans'
  | 'financialExecutionOrderLocks'
  | 'financialExecutionLotLocks'
  | 'financialSourceGenerations'
  | 'financialActiveSources'
  | 'financialExecutionSourcePlans'
  | 'financialExecutionLotPlans'
  | 'financialExecutionStockPlans'
  | 'financialProofEntries'
  | 'financialProofChunks'
  | 'financialProofNodes'
  | 'financialProofManifests'
  | 'financialExecutionSteps'
  | 'financialExecutionEvents'
  | 'orderLifecycleStates'
  | 'returnResolutionStates'
  | 'creditLots'
  | 'creditApplications'
  | 'refundObligations'
  | 'refundConfirmations'
  | 'returns'
  | 'returnEvents'
  | 'returnReceipts'
  | 'orderReturnLines'
  | 'catalogSettings'
  | 'catalogOperations';
export class CommercialRepository {
  constructor(
    readonly foundation: FoundationRepository,
    readonly secret: string,
  ) {}
  ref(tenantId: string, collection: CommercialCollection, id: string): DocumentReference {
    return this.foundation
      .global('tenants', tenantId)
      .collection(collection)
      .doc(opaqueId.parse(id));
  }
  async list<T extends { id: string; tenantId: string; assignedTo?: string | null }>(
    actor: Actor,
    tenantId: string,
    collection: 'customers' | 'products' | 'categories',
    schema: z.ZodType<T>,
    input: CommercialQuery,
    seller: boolean,
    tx?: Transaction,
  ) {
    const status = input.status ?? 'active';
    requireCondition(
      !(seller && collection !== 'customers' && status !== 'active'),
      403,
      'FORBIDDEN',
      'Operação não permitida',
    );
    requireCondition(
      !(seller && input.assignedTo && input.assignedTo !== actor.uid),
      403,
      'FORBIDDEN',
      'Operação não permitida',
    );
    const sort = input.sort ?? 'name';
    const direction = input.direction ?? 'asc';
    requireCondition(
      !input.q || (sort === 'name' && direction === 'asc'),
      422,
      'VALIDATION_ERROR',
      'Busca por prefixo exige ordenação name asc',
    );
    const scope = digest(
      stableJson({ actor: actor.uid, tenantId, collection, seller, ...input, cursor: undefined }),
    );
    let query: Query = this.ref(tenantId, collection, 'placeholder').parent;
    if (status !== 'all') query = query.where('status', '==', status);
    if (collection === 'customers') {
      if (seller) query = query.where('assignedTo', '==', actor.uid);
      else if (input.assignedTo)
        query = query.where(
          'assignedTo',
          '==',
          input.assignedTo === 'unassigned' ? null : input.assignedTo,
        );
    }
    if (input.categoryId) query = query.where('categoryId', '==', input.categoryId);
    if (input.sku) query = query.where('sku', '==', input.sku);
    if (input.catalogVisible)
      query = query.where('catalogVisible', '==', input.catalogVisible === 'true');
    const orderField = sort === 'name' ? 'nameKey' : 'createdAt';
    if (input.q) {
      const prefix = searchKey(input.q);
      query = query.where('nameKey', '>=', prefix).where('nameKey', '<=', prefix + '\uf8ff');
    }
    query = query.orderBy(orderField, direction).orderBy(FieldPath.documentId(), direction);
    const cursorId = decodeCursor(this.secret, scope, input.cursor);
    if (cursorId) {
      const cursorRef = this.ref(tenantId, collection, cursorId);
      const cursor = tx ? await tx.get(cursorRef) : await cursorRef.get();
      requireCondition(
        cursor.exists &&
          (!seller || collection !== 'customers' || cursor.get('assignedTo') === actor.uid),
        422,
        'VALIDATION_ERROR',
        'Cursor indisponível',
      );
      query = query.startAfter(cursor);
    }
    const limit = Number(input.limit ?? '25');
    const pageQuery = query.limit(limit + 1);
    const page = tx ? await tx.get(pageQuery) : await pageQuery.get();
    const documents = page.docs.slice(0, limit);
    const items = documents.map((snapshot) => {
      const parsed = schema.safeParse(snapshot.data());
      if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.id !== snapshot.id)
        throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
      return parsed.data;
    });
    return {
      items,
      nextCursor:
        page.size > limit && documents.length
          ? encodeCursor(this.secret, scope, documents[documents.length - 1]!.id)
          : null,
    };
  }
}
