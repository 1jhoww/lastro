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
    // Cotas por hora: "alguns segundos" orientaria errado quando o servidor diz quanto falta.
    if (this.kind === 'rateLimited' && (this.retryAfterSeconds ?? 0) > 60)
      return `Limite de tentativas atingido. Tente de novo em ${waitText(this.retryAfterSeconds!)}.`;
    return messages[this.code] ?? fallback[this.kind];
  }
}

/** "12 min" ou "1 h 5 min" a partir dos segundos de Retry-After. */
export function waitText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
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
    'Não conseguimos guardar esta operação no aparelho com segurança, então ela não foi enviada. Recarregue a página e tente de novo.',
  RETURN_REQUIRED:
    'Este pedido já foi expedido. Para desfazer, registre uma devolução em vez de cancelar.',
  RETURN_VALUE_LIMIT:
    'O valor aceito passa do limite desta devolução. Atualize a tela e revise o valor da avaria.',
  DAMAGED_ACCEPTANCE_REQUIRED: 'Decida o que fazer com cada item recebido com avaria.',
  FINANCIAL_RESUMABLE_REQUIRED:
    'Este pedido tem muitos registros e precisa ser processado em etapas. Escolha “Em etapas, com acompanhamento” e confirme de novo.',
  EXECUTION_CONFLICT: 'A operação avançou em outro lugar. Atualize a situação antes de continuar.',
  EXECUTION_LEASE_CONFLICT:
    'Outra pessoa ou aba está continuando esta operação. Atualize a situação ou retome informando o motivo.',
  EXECUTION_REVIEW_REQUIRED:
    'Esta operação precisa de revisão administrativa. Informe a referência ao suporte.',
  EXECUTION_ABORT_NOT_ALLOWED:
    'A operação já começou a aplicar valores e não pode mais ser interrompida. Continue até concluir.',
  EXCESS_PAYMENT:
    'O valor é maior que o saldo atual da parcela. Atualize a tela e informe até o saldo restante.',
  INVALID_PAYMENT_DATE: 'A data do pagamento não pode ser futura. Use hoje ou uma data anterior.',
  INVALID_ALLOCATION: 'A parcela mudou desde que a tela foi aberta. Atualize e tente de novo.',
  CREDIT_ORIGIN_INVALID: 'Este crédito não pode ser usado neste pedido. Confira cliente e origem.',
  REQUEST_OUTCOME_UNKNOWN:
    'Não conseguimos confirmar se deu certo. Nada foi repetido: confira antes de tentar de novo.',
  FINANCIAL_INTEGRITY:
    'Encontramos uma inconsistência nos registros financeiros deste pedido. Fale com o suporte.',
  // 409 por regra (ADR 0008): recarregar não libera; o fallback de conflito orientaria errado.
  LEGACY_FINANCIAL_REVIEW_REQUIRED:
    'Este pedido tem registros financeiros antigos sem origem comprovada. Novos lançamentos ficam bloqueados até a revisão administrativa.',
  FINANCIAL_SOURCE_GENERATION_STALE:
    'Os registros financeiros do pedido mudaram durante a preparação da execução. Consulte o estado oficial antes de avançar de novo.',
  RETURN_NOT_RESOLVABLE:
    'Não há quantidade pendente para resolver ou falta decidir sobre itens danificados. Atualize a devolução e revise as decisões.',
  CREDIT_LIMIT: 'O cliente não tem crédito suficiente para esse valor. Atualize a tela e revise.',
  REVERSAL_LIMIT:
    'O valor é maior do que ainda pode ser estornado. Parte dele já pode ter sido estornada antes.',
  REFUND_LIMIT: 'O valor é maior que o reembolso pendente. Atualize a tela e revise.',
  REAUTHENTICATION_REQUIRED: 'Confirme sua senha novamente para autorizar esta operação sensível.',
  PAYMENT_METHOD_CHANGED:
    'Essa forma de pagamento foi alterada ou desativada. Escolha outra forma disponível.',
  DUPLICATE_PAYMENT_SETTING:
    'Já existe uma condição ou forma com esse nome. Use outro nome ou edite a existente.',
  RETURN_FINANCIAL_BLOCK:
    'Há uma devolução em andamento neste pedido. Conclua-a antes de usar crédito ou estornar.',
  FINANCIAL_OPERATION_IN_PROGRESS:
    'Há uma operação em andamento neste pedido. Conclua-a antes de registrar outra.',
  FINANCIAL_LOT_LOCKED:
    'Este crédito está reservado por outra operação em andamento. Tente de novo quando ela terminar.',
  TENANT_ACCESS_DENIED: 'Você não tem acesso ativo a esta empresa.',
  USER_LIMIT_REACHED:
    'Todas as vagas do plano estão ocupadas. Revogue um convite ou desative um usuário.',
  LAST_ADMIN_REQUIRED: 'A empresa precisa de pelo menos um administrador ativo.',
  IDENTITY_DISABLED:
    'A conta desta pessoa está bloqueada no Lastro. Desbloqueie a conta antes de reativar o acesso.',
  IDENTITY_NOT_FOUND: 'A conta de acesso desta pessoa não existe mais. Envie um novo convite.',
  SUPPORT_ACCESS_ENDED: 'Este acesso de suporte terminou: a pessoa não é mais Super Admin.',
  PLATFORM_ACCOUNT_PROTECTED: 'Contas do Super Admin não são alteradas por este fluxo.',
  FEATURE_NOT_IN_PLAN: 'Este recurso não está incluído no plano contratado pela empresa.',
  CUSTOMER_ADMIN_REQUIRED:
    'O primeiro administrador precisa ser alguém da empresa cliente, não a conta de Super Admin.',
  INVITATION_EXPIRED: 'Este convite venceu. Peça um novo ao administrador.',
  INVITATION_INVALID: 'Convite inválido, já usado ou revogado.',
  DUPLICATE_DOCUMENT: 'Já existe um cliente com este CPF/CNPJ.',
  DUPLICATE_SKU: 'Já existe um produto com este SKU.',
  INVALID_ASSIGNEE: 'O responsável escolhido não é um vendedor ativo da empresa.',
  INVALID_CATEGORY: 'Categoria inativa ou inexistente.',
  INVALID_IMAGE: 'Imagem inválida ou corrompida. Salve uma cópia em JPEG ou PNG e envie de novo.',
  IMAGE_TOO_LARGE: 'Arquivo muito grande: o limite é 5 MB.',
  UNSUPPORTED_IMAGE_FORMAT: 'Formato incompatível. Use JPEG, PNG ou WebP.',
  IMAGE_RESOLUTION_LIMIT: 'Resolução acima de 50 megapixels. Reduza a foto e envie de novo.',
  DUE_DATE_LOCKED:
    'Esta parcela já foi quitada, cancelada ou não tem saldo; o vencimento não pode mudar.',
  DUE_DATE_UNCHANGED: 'Escolha uma data diferente do vencimento atual.',
  DUE_DATE_ORDER:
    'A nova data precisa ficar entre o vencimento da parcela anterior e o da seguinte.',
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
