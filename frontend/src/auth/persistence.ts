import { indexedDBLocalPersistence, type Persistence } from 'firebase/auth';

/**
 * Web: sessão do Firebase em IndexedDB, isolada por origem. Nativo usa persistence.native.ts.
 * A sessão contém o refresh token; nenhum token é copiado para localStorage pelo app.
 */
export const authPersistence: Persistence = indexedDBLocalPersistence;
