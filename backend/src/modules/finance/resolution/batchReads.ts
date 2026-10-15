import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

/** Cache only explicit bounded point reads within this transaction's snapshot. */
export async function batchReads(tx: Transaction, refs: DocumentReference[]): Promise<Transaction> {
  const unique = [...new Map(refs.map((ref) => [ref.path, ref])).values()];
  const snapshots = unique.length ? await tx.getAll(...unique) : [];
  const cache = new Map<string, DocumentSnapshot>(snapshots.map((doc) => [doc.ref.path, doc]));
  return new Proxy(tx, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property);
      if (typeof method !== 'function') return method;
      if (property === 'get')
        return (ref: unknown, ...args: unknown[]) => {
          if (
            ref &&
            typeof ref === 'object' &&
            'path' in ref &&
            typeof ref.path === 'string' &&
            !args.length
          ) {
            const doc = cache.get(ref.path);
            if (doc) return Promise.resolve(doc);
          }
          return Reflect.apply(method, target, [ref, ...args]);
        };
      return method.bind(target);
    },
  });
}
