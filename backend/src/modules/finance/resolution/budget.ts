import type { Transaction } from 'firebase-admin/firestore';
import { stableJson } from '../../../shared/utils/crypto.js';

export class SplitFinancialBatch extends Error {}
export class FinancialBatchMeter {
  reads = 0;
  writes = 0;
  bytes = 0;
  maxDocumentBytes = 0;
  wrap(tx: Transaction): Transaction {
    return new Proxy(tx, {
      get: (target, property) => {
        const method = Reflect.get(target, property) as unknown;
        if (typeof method !== 'function') return method;
        if (property === 'get' || property === 'getAll')
          return async (...args: unknown[]) => {
            const result: unknown = await Reflect.apply(method, target, args);
            this.reads += Array.isArray(result)
              ? result.length
              : result &&
                  typeof result === 'object' &&
                  'docs' in result &&
                  Array.isArray(result.docs)
                ? result.docs.length
                : 1;
            if (this.reads > 150) throw new SplitFinancialBatch('Read budget');
            return result;
          };
        if (['set', 'create', 'update', 'delete'].includes(String(property)))
          return (...args: unknown[]) => {
            const size = args.length > 1 ? Buffer.byteLength(stableJson(args[1]), 'utf8') : 0;
            this.writes++;
            this.bytes += size * 2 + 512;
            this.maxDocumentBytes = Math.max(this.maxDocumentBytes, size);
            if (this.writes > 100 || this.bytes > 2 * 1024 * 1024 || size > 256 * 1024)
              throw new SplitFinancialBatch('Write budget');
            Reflect.apply(method, target, args);
            return tx;
          };
        return method.bind(target);
      },
    });
  }
}
