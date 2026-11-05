import type { Query, Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type {
  CommercialCollection,
  CommercialRepository,
} from '../../infrastructure/repositories/commercialRepository.js';
import { requireCondition } from '../errors/appError.js';
import { decodeCursor, encodeCursor } from '../utils/crypto.js';

/**
 * One cursor page of an already ordered query. The signed cursor is bound to `scope`, every
 * document is validated and must belong to the tenant.
 */
export async function cursorPage<T extends { id: string; tenantId: string }>(options: {
  repo: CommercialRepository;
  tx: Transaction;
  tenantId: string;
  collection: CommercialCollection;
  scope: string;
  query: Query;
  input: { limit?: string | undefined; cursor?: string | undefined };
  schema: z.ZodType<T>;
}) {
  const { repo, tx, tenantId, collection, scope, input, schema } = options;
  let query = options.query;
  const cursorId = decodeCursor(repo.secret, scope, input.cursor);
  if (cursorId) {
    const cursor = await tx.get(repo.ref(tenantId, collection, cursorId));
    requireCondition(cursor.exists, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
    query = query.startAfter(cursor);
  }
  const limit = Number(input.limit ?? '25');
  const page = await tx.get(query.limit(limit + 1));
  const docs = page.docs.slice(0, limit);
  const items = await Promise.all(
    docs.map(async (doc) => {
      const value = await repo.foundation.readSnapshot(doc, schema, tx);
      requireCondition(
        value?.tenantId === tenantId && value.id === doc.id,
        500,
        'INTERNAL_ERROR',
        'Erro interno do servidor',
      );
      return value;
    }),
  );
  return {
    items,
    nextCursor:
      page.size > limit && docs.length
        ? encodeCursor(repo.secret, scope, docs[docs.length - 1]!.id)
        : null,
  };
}
