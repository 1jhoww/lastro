import { initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import type { Config } from '../../config/env.js';
export interface Firebase {
  app: App;
  auth: Auth;
  db: Firestore;
  bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>;
}
export function createFirebase(config: Config): Firebase {
  const app = initializeApp(
    {
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      ...(config.mode === 'production' ? { credential: applicationDefault() } : {}),
    },
    `lastro-${randomUUID()}`,
  );
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: false });
  return { app, auth: getAuth(app), db, bucket: getStorage(app).bucket() };
}
