import type { AuthGateway, AuthUser } from '@/auth/gateway';

type Account = { uid: string; email: string; password: string; emailVerified: boolean };

/**
 * Provedor de identidade falso para testes. Comporta-se como o Firebase nos pontos que o app usa:
 * notifica mudanças, recusa credencial errada com auth/invalid-credential e emite tokens
 * versionados para os testes de renovação.
 */
export class FakeGateway implements AuthGateway {
  user: AuthUser | null = null;
  accounts: Account[] = [];
  tokenVersion = 1;
  failRefresh: string | null = null;
  authTimeSeconds = Math.floor(Date.now() / 1000);
  resetRequests: string[] = [];
  verificationsSent = 0;
  private listeners = new Set<(u: AuthUser | null) => void>();

  constructor(opts: { initialUser?: AuthUser | null; accounts?: Account[] } = {}) {
    this.accounts = opts.accounts ?? [];
    this.user = opts.initialUser ?? null;
  }

  private emit() {
    for (const l of this.listeners) l(this.user);
  }

  onChange(listener: (u: AuthUser | null) => void) {
    this.listeners.add(listener);
    // Como o Firebase: notifica o estado atual logo após a leitura da persistência.
    queueMicrotask(() => listener(this.user));
    return () => this.listeners.delete(listener);
  }

  async signIn(email: string, password: string) {
    const acc = this.accounts.find((a) => a.email === email);
    if (!acc || acc.password !== password) throw { code: 'auth/invalid-credential' };
    this.user = { uid: acc.uid, email: acc.email, emailVerified: acc.emailVerified };
    this.authTimeSeconds = Math.floor(Date.now() / 1000);
    this.emit();
  }

  async signOut() {
    this.user = null;
    this.emit();
  }

  async sendPasswordReset(email: string) {
    if (email === 'offline@lastro.test') throw { code: 'auth/network-request-failed' };
    if (!this.accounts.some((a) => a.email === email)) throw { code: 'auth/user-not-found' };
    this.resetRequests.push(email);
  }

  async createAccount(email: string, password: string) {
    if (this.accounts.some((a) => a.email === email)) throw { code: 'auth/email-already-in-use' };
    const acc = { uid: `uid-${this.accounts.length + 1}`, email, password, emailVerified: false };
    this.accounts.push(acc);
    this.user = { uid: acc.uid, email, emailVerified: false };
    this.emit();
  }

  async sendEmailVerification() {
    this.verificationsSent += 1;
  }

  async reloadUser() {
    if (!this.user) return null;
    const acc = this.accounts.find((a) => a.uid === this.user?.uid);
    this.user = { ...this.user, emailVerified: acc?.emailVerified ?? this.user.emailVerified };
    return this.user;
  }

  emailChangesRequested: string[] = [];

  async requestEmailChange(newEmail: string) {
    this.emailChangesRequested.push(newEmail);
  }

  async reauthenticate(password: string) {
    const acc = this.accounts.find((a) => a.uid === this.user?.uid);
    if (!acc || acc.password !== password) throw { code: 'auth/invalid-credential' };
    this.authTimeSeconds = Math.floor(Date.now() / 1000);
  }

  async getIdToken(force = false) {
    if (!this.user) return null;
    if (force) {
      if (this.failRefresh) throw { code: this.failRefresh };
      this.tokenVersion += 1;
    }
    return `token-${this.user.uid}-v${this.tokenVersion}`;
  }

  async authTime() {
    return this.user ? this.authTimeSeconds : null;
  }
}
