/**
 * Mensagens para erros do Firebase Authentication. Credencial errada nunca diz se o e-mail
 * existe: "e-mail ou senha incorretos" cobre os dois casos.
 */
const messages: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Informe sua senha.',
  'auth/user-disabled': 'Esta conta foi desativada. Fale com o administrador da sua empresa.',
  'auth/too-many-requests':
    'Muitas tentativas seguidas. Aguarde alguns minutos ou recupere sua senha.',
  'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
  'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Entre com sua senha.',
  'auth/weak-password': 'Senha fraca. Use pelo menos 8 caracteres.',
  'auth/requires-recent-login': 'Por segurança, entre novamente para continuar.',
  'auth/user-token-expired': 'Sua sessão terminou. Entre novamente para continuar.',
  'auth/user-mismatch': 'A senha informada é de outra conta.',
};

export function authErrorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code;
  return 'auth/unknown';
}

export function authErrorMessage(e: unknown): string {
  return (
    messages[authErrorCode(e)] ?? 'Não foi possível concluir agora. Tente de novo em instantes.'
  );
}

/** Falhas que significam sessão perdida (não falha de rede). */
export function isSessionLost(e: unknown): boolean {
  const code = authErrorCode(e);
  return (
    code === 'auth/user-token-expired' ||
    code === 'auth/user-disabled' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-user-token'
  );
}

export function isNetworkFailure(e: unknown): boolean {
  return authErrorCode(e) === 'auth/network-request-failed';
}
