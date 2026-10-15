/**
 * Fronteira entre o app e o provedor de identidade. O app só conhece esta interface; a
 * implementação real usa o Firebase Client SDK (firebaseGateway.ts) e os testes usam uma falsa.
 *
 * Login, logout, verificação de e-mail, recuperação de senha e reautenticação pertencem ao
 * provedor: o backend não tem endpoint de login.
 */

export type AuthUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
};

export type Unsubscribe = () => void;

export interface AuthGateway {
  /** Chamado com o usuário atual assim que a persistência é lida, e a cada mudança. */
  onChange(listener: (user: AuthUser | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  createAccount(email: string, password: string): Promise<void>;
  sendEmailVerification(): Promise<void>;
  /** Relê o usuário no provedor (ex.: depois de confirmar o e-mail em outra aba). */
  reloadUser(): Promise<AuthUser | null>;
  /** Pede nova senha ao usuário logado; renova `auth_time` para rotas da plataforma. */
  reauthenticate(password: string): Promise<void>;
  /** ID Token atual; `force` ignora o cache e pede um novo ao provedor. */
  getIdToken(force?: boolean): Promise<string | null>;
  /** Momento da última autenticação com senha, em segundos (claim `auth_time`). */
  authTime(): Promise<number | null>;
}

/** Erro do provedor com código estável (`auth/...`). */
export class AuthGatewayError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AuthGatewayError';
  }
}
