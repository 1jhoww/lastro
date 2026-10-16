import { toApiError } from '@/api/errors';

export type InviteFailure = {
  title: string;
  body: string;
  /** Já é membro: oferecer entrar na empresa em vez de tentar de novo. */
  alreadyMember?: boolean;
  /** Vale tentar de novo (rede, servidor). */
  retry?: boolean;
};

/**
 * Erros de POST /users/invitations/accept. O backend devolve INVITATION_INVALID tanto para convite
 * usado/revogado quanto para e-mail diferente do convidado, então a mensagem cobre os dois casos.
 */
export function inviteFailure(e: unknown, email: string | null): InviteFailure {
  const err = toApiError(e);
  switch (err.code) {
    case 'INVITATION_EXPIRED':
      return {
        title: 'Este convite venceu',
        body: 'Convites valem sete dias. Peça um novo ao administrador da empresa.',
      };
    case 'INVITATION_INVALID':
      return {
        title: 'Convite não pode ser usado',
        body: `Ele já foi usado, foi revogado ou foi enviado para outro e-mail. Você está usando ${
          email ?? 'uma conta sem e-mail'
        }. Se o convite é para outro endereço, saia e entre com ele.`,
      };
    case 'CONFLICT':
      return {
        title: 'Você já faz parte desta empresa',
        body: 'Este convite não é mais necessário.',
        alreadyMember: true,
      };
    case 'USER_LIMIT_REACHED':
      return {
        title: 'A empresa atingiu o limite de usuários',
        body: 'Todas as vagas do plano estão ocupadas. Avise o administrador para liberar uma vaga.',
      };
    case 'LAST_ADMIN_REQUIRED':
      return {
        title: 'Empresa ainda em configuração',
        body: 'O primeiro acesso precisa ser de um administrador. Aguarde o administrador aceitar o convite dele.',
      };
    case 'CUSTOMER_ADMIN_REQUIRED':
      return {
        title: 'Convite inicial é da empresa cliente',
        body: 'Sua conta é de Super Admin e não ocupa vaga. O primeiro administrador precisa ser um usuário da própria empresa.',
      };
    case 'SUBSCRIPTION_SUSPENDED':
    case 'SUBSCRIPTION_INACTIVE':
      return {
        title: 'Acesso da empresa indisponível',
        body: 'A assinatura desta empresa está suspensa ou encerrada. Fale com o administrador.',
      };
    case 'FORBIDDEN':
      return {
        title: 'Sua conta não pode aceitar convites',
        body: 'Esta identidade está desativada no Lastro. Fale com o suporte da Hepta.',
      };
  }
  if (err.kind === 'validation')
    return { title: 'Link de convite inválido', body: 'Confira se o link foi copiado inteiro.' };
  if (err.kind === 'session')
    return { title: 'Sua sessão terminou', body: 'Entre novamente para aceitar o convite.' };
  return { title: 'Não foi possível aceitar agora', body: err.userMessage, retry: true };
}
