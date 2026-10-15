/**
 * Erros da API do Lastro. O backend responde `{ error: { code, message, status, requestId } }` sem
 * detalhes por campo; o app decide pelo `code` estável, nunca pelo texto da mensagem.
 */

export type ErrorKind =
  | 'session' // token ausente/expirado: renovar ou pedir login
  | 'forbidden' // sem permissão ou vínculo
  | 'subscription' // assinatura suspensa/cancelada
  | 'conflict' // versão desatualizada ou estado mudou: recarregar e decidir
  | 'validation' // dados recusados
  | 'notFound' // inexistente ou fora da carteira (404 seguro)
  | 'rateLimited'
  | 'network' // sem resposta do servidor
  | 'server';

export class ApiError extends Error {
  readonly kind: ErrorKind;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = classify(status, code);
  }

  /** Mensagem para a interface, em pt-BR, derivada do código. */
  get userMessage(): string {
    return messages[this.code] ?? fallback[this.kind];
  }
}

export function retryAfterSeconds(response: Response) {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function classify(status: number, code: string): ErrorKind {
  if (code === 'NETWORK_ERROR' || status === 0) return 'network';
  if (code === 'SUBSCRIPTION_SUSPENDED' || code === 'SUBSCRIPTION_INACTIVE') return 'subscription';
  if (status === 401) return 'session';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rateLimited';
  if (status >= 400 && status < 500) return 'validation';
  return 'server';
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Converte qualquer falha em ApiError para o tratamento central. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Falha de rede');
}

const fallback: Record<ErrorKind, string> = {
  session: 'Sua sessão terminou. Entre novamente para continuar.',
  forbidden: 'Seu perfil não tem acesso a esta ação.',
  subscription: 'O acesso da empresa está suspenso. Fale com o administrador da conta.',
  conflict: 'Estes dados mudaram desde que você abriu a tela. Recarregue para ver a versão atual.',
  validation: 'Alguns dados não foram aceitos. Revise e tente de novo.',
  notFound: 'Registro não encontrado ou fora do seu acesso.',
  rateLimited: 'Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.',
  network: 'Sem conexão com o servidor. Verifique a internet e tente de novo.',
  server: 'O servidor não concluiu a operação. Tente de novo em instantes.',
};

/** Códigos do contrato atual (backend Fases A–D) com orientação específica. */
const messages: Record<string, string> = {
  INTENT_STORAGE_UNAVAILABLE:
    'Armazenamento local indisponível ou checkpoint incompleto. Nenhuma nova operação financeira será enviada. Recupere estado oficial e tente novamente.',
  RETURN_REQUIRED:
    'Pedido expedido exige devolução física própria. Cancelamento financeiro direto não é permitido.',
  RETURN_VALUE_LIMIT:
    'Aceite financeiro excede limite oficial do recebido. Atualize preview e revise decisão de dano.',
  DAMAGED_ACCEPTANCE_REQUIRED: 'Decida explicitamente aceite ou rejeição de cada dano recebido.',
  FINANCIAL_RESUMABLE_REQUIRED:
    'Histórico exige execução retomável. Atualize estado e revise início explícito; não repita cancelamento atômico.',
  EXECUTION_CONFLICT: 'Revisão mudou. Consulte estado oficial antes de revisar outro passo.',
  EXECUTION_LEASE_CONFLICT:
    'Lease ou fence não autoriza este avanço. Consulte estado e revise retomada com senha recente.',
  EXECUTION_REVIEW_REQUIRED:
    'Execução exige revisão administrativa. Preserve plano e consulte referência oficial.',
  EXECUTION_ABORT_NOT_ALLOWED:
    'Abort não permitido após aplicação. Continue recuperação da mesma execução.',
  CREDIT_LIMIT: 'Saldo de crédito insuficiente. Recarregue a fonte antes de revisar o valor.',
  REVERSAL_LIMIT:
    'O valor excede a alocação ainda reversível. Parte pode ter sido estornada ou destinada anteriormente.',
  REFUND_LIMIT: 'O valor excede a obrigação pendente. Recarregue o reembolso antes de revisar.',
  REAUTHENTICATION_REQUIRED: 'Confirme sua senha novamente para autorizar esta operação sensível.',
  PAYMENT_METHOD_CHANGED:
    'A forma foi alterada ou desativada. Recarregue as opções e escolha uma forma ativa.',
  DUPLICATE_PAYMENT_SETTING:
    'Já existe condição ou forma com este nome. Consulte os cadastros antes de criar outra.',
  RETURN_FINANCIAL_BLOCK:
    'Há devolução ativa neste pedido. Consulte a pendência antes de aplicar crédito ou estornar.',
  FINANCIAL_OPERATION_IN_PROGRESS:
    'Há execução financeira pendente neste pedido. Aguarde publicação confirmada pelo servidor.',
  FINANCIAL_LOT_LOCKED:
    'A fonte de crédito está bloqueada por outra execução. Não use valor preparado como disponível.',
  TENANT_ACCESS_DENIED: 'Você não tem acesso ativo a esta empresa.',
  USER_LIMIT_REACHED:
    'Todas as vagas do plano estão ocupadas. Revogue um convite ou desative um usuário.',
  LAST_ADMIN_REQUIRED: 'A empresa precisa de pelo menos um administrador ativo.',
  INVITATION_EXPIRED: 'Este convite venceu. Peça um novo ao administrador.',
  INVITATION_INVALID: 'Convite inválido, já usado ou revogado.',
  DUPLICATE_DOCUMENT: 'Já existe um cliente com este CPF/CNPJ.',
  DUPLICATE_SKU: 'Já existe um produto com este SKU.',
  INVALID_ASSIGNEE: 'O responsável escolhido não é um vendedor ativo da empresa.',
  INVALID_CATEGORY: 'Categoria inativa ou inexistente.',
  INVALID_IMAGE: 'Imagem não aceita. Use JPEG, PNG ou WebP de até 5 MB.',
  INVALID_QUANTITY: 'Quantidade inválida.',
  INVALID_PRECISION: 'Esta unidade não aceita essa quantidade de casas decimais.',
  QUANTITY_LIMIT_EXCEEDED: 'Quantidade acima do limite permitido.',
  INSUFFICIENT_STOCK: 'Estoque disponível insuficiente para esta operação.',
  UNIT_LOCKED: 'A unidade não pode mudar depois da primeira movimentação de estoque.',
  INVALID_ORDER_STATE: 'O pedido mudou de situação. Recarregue para ver o estado atual.',
  PRODUCT_UNAVAILABLE: 'Um dos produtos está inativo ou indisponível.',
  CUSTOMER_INACTIVE: 'O cliente está inativo.',
  INCOMPLETE_ORDER: 'Complete cliente, itens e condição de pagamento antes de confirmar.',
  ORDER_TOTAL_REQUIRED: 'O total do pedido precisa ser maior que zero.',
  ORDER_VALUE_LIMIT: 'O valor do pedido excede o limite técnico.',
  ORDER_TECHNICAL_LIMIT: 'O pedido ficou grande demais para ser salvo. Divida em dois pedidos.',
  DISCOUNT_APPROVAL_REQUIRED: 'O desconto precisa de nova aprovação de um administrador.',
  INVALID_DISCOUNT: 'Desconto inválido para este pedido.',
  INVALID_DUE_DATE: 'Datas de vencimento inválidas: use datas futuras, em ordem.',
  INVALID_RESPONSIBLE: 'O responsável escolhido não pode assumir este pedido.',
  INVALID_RESERVATION: 'A reserva de estoque deste pedido está inconsistente.',
  FINANCIAL_CANCELLATION_REQUIRED:
    'Este pedido tem registros financeiros e não pode ser cancelado diretamente.',
  RECEIVABLE_INTEGRITY: 'As parcelas deste pedido estão inconsistentes. Contate o suporte.',
};
