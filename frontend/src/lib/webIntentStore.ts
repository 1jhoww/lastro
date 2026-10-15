import {
  canonicalJson,
  readIntentRows,
  type DurableIntent,
  type IntentStore,
} from './intentStorageCore';
/** IndexedDB confirma commit por partição, inclusive entre abas. Não guarda token nem senha. */
export function createWebIntentStore(): IntentStore {
  const db = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB)
        return reject(new Error('IndexedDB indisponível; operação bloqueada'));
      const request = indexedDB.open('lastro-critical-intents-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('owners');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Armazenamento ocupado'));
      request.onsuccess = () => resolve(request.result);
    });
  return {
    async read(owner) {
      const connection = await db();
      try {
        return await new Promise<DurableIntent[]>((resolve, reject) => {
          const tx = connection.transaction('owners', 'readonly'),
            request = tx.objectStore('owners').get(owner);
          request.onsuccess = () => {
            try {
              resolve(readIntentRows(request.result ?? null, owner));
            } catch (e) {
              reject(e);
            }
          };
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error ?? new Error('Leitura local interrompida'));
        });
      } finally {
        connection.close();
      }
    },
    async change(owner, update) {
      const connection = await db();
      try {
        return await new Promise<DurableIntent[]>((resolve, reject) => {
          const tx = connection.transaction('owners', 'readwrite'),
            store = tx.objectStore('owners'),
            request = store.get(owner);
          let rows: DurableIntent[];
          request.onsuccess = () => {
            try {
              rows = update(readIntentRows(request.result ?? null, owner));
              const raw = canonicalJson(rows);
              readIntentRows(raw, owner);
              store.put(raw, owner);
            } catch (e) {
              tx.abort();
              reject(e);
            }
          };
          tx.oncomplete = () => resolve(rows);
          tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Gravação local recusada'));
        });
      } finally {
        connection.close();
      }
    },
  };
}
