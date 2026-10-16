import { randomBytes, randomUUID } from 'node:crypto';
import { deleteApp } from 'firebase-admin/app';
import { loadConfig } from '../src/config/env.js';
import { createFirebase } from '../src/infrastructure/firebase/client.js';
import { FoundationRepository } from '../src/infrastructure/repositories/foundationRepository.js';
import { recordAudit } from '../src/shared/audit/audit.js';
const config = loadConfig();
if (config.mode !== 'emulator' || config.projectId !== 'demo-lastro-phase-a')
  throw new Error('Seed permitido somente no projeto demo local');
const firebase = createFirebase(config);
const repo = new FoundationRepository(firebase.db);
const now = new Date().toISOString();
try {
  const uid = 'local-platform-admin';
  let exists = true;
  try {
    await firebase.auth.getUser(uid);
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'auth/user-not-found'
    )
      throw error;
    exists = false;
  }
  if (exists)
    console.log(
      'Identidade local já existente; credenciais preservadas. Recuperação pelo Auth Emulator.',
    );
  else {
    const password = randomBytes(24).toString('base64url');
    await firebase.auth.createUser({
      uid,
      email: 'platform.demo@lastro.invalid',
      emailVerified: true,
      password,
    });
    await firebase.db.runTransaction(async (tx) => {
      tx.create(repo.global('identities', uid), {
        uid,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
      });
      tx.create(repo.global('platformAdmins', uid), {
        uid,
        status: 'active',
        createdAt: now,
        schemaVersion: 1,
      });
      recordAudit(
        repo,
        tx,
        {
          uid,
          email: 'platform.demo@lastro.invalid',
          emailVerified: true,
          authTime: Date.now() / 1000,
          requestId: randomUUID(),
        },
        null,
        'platform.bootstrap.local',
        uid,
        now,
        {},
      );
    });
    // One-time credential handoff in an operator-only local command, never API logs.
    console.log(
      `Email local: platform.demo@lastro.invalid\nSenha temporária local (não reutilizar): ${password}`,
    );
  }
  // Plans are the official catalog in code (Essencial, Profissional); nothing to seed.
} finally {
  await firebase.db.terminate();
  await deleteApp(firebase.app);
}
