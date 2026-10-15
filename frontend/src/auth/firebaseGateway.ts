import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  EmailAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { Env } from '@/config/env';
import { AuthGatewayError, type AuthGateway, type AuthUser } from './gateway';
import { authPersistence } from './persistence';

const toUser = (u: User | null): AuthUser | null =>
  u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified } : null;

function createAuth(env: Env): Auth {
  const existing = getApps()[0];
  const app =
    existing ??
    initializeApp({
      apiKey: env.firebaseApiKey,
      projectId: env.firebaseProjectId,
      authDomain: `${env.firebaseProjectId}.firebaseapp.com`,
    });
  // Fast refresh reexecuta módulos: initializeAuth só pode rodar uma vez por app.
  if (existing) return getAuth(getApp());
  const auth = initializeAuth(app, { persistence: authPersistence });
  auth.languageCode = 'pt-BR';
  if (env.authEmulatorUrl)
    connectAuthEmulator(auth, env.authEmulatorUrl, { disableWarnings: true });
  return auth;
}

/** Implementação real do AuthGateway com o Firebase Client SDK. */
export function createFirebaseGateway(env: Env): AuthGateway {
  const auth = createAuth(env);
  const current = () => {
    const u = auth.currentUser;
    if (!u) throw new AuthGatewayError('auth/no-current-user');
    return u;
  };

  return {
    onChange: (listener) => onAuthStateChanged(auth, (u) => listener(toUser(u))),
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    async signOut() {
      await signOut(auth);
    },
    async sendPasswordReset(email) {
      await sendPasswordResetEmail(auth, email.trim());
    },
    async createAccount(email, password) {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    },
    async sendEmailVerification() {
      await sendEmailVerification(current());
    },
    async reloadUser() {
      const u = auth.currentUser;
      if (!u) return null;
      await u.reload();
      // Força novo token para o claim email_verified chegar atualizado ao backend.
      await u.getIdToken(true);
      return toUser(auth.currentUser);
    },
    async reauthenticate(password) {
      const u = current();
      if (!u.email) throw new AuthGatewayError('auth/no-email');
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
      await u.getIdToken(true);
    },
    async getIdToken(force = false) {
      const u = auth.currentUser;
      return u ? u.getIdToken(force) : null;
    },
    async authTime() {
      const u = auth.currentUser;
      if (!u) return null;
      const result = await u.getIdTokenResult();
      const t = Number(result.claims.auth_time);
      return Number.isFinite(t) ? t : null;
    },
  };
}
