import type {
  ConditionOption,
  FinancialExecution,
  MethodOption,
  Order,
  OrderEvent,
  OrderStatus,
  OrderUpdate,
} from '@/api/types';
import type { BadgeTone } from '@/ui';
import { toApiQuantity, type Unit } from '@/lib/quantity';

/**
 * Regras de apresentação e montagem de pedidos. Valores oficiais (preços registrados, descontos,
 * totais, parcelas) vêm sempre do servidor; aqui só há prévia do carrinho e formatação.
 */

export const statusLabel: Record<OrderStatus, string> = {
  draft: 'Rascunho',
  confirmed: 'Confirmado',
  dispatched: 'Expedido',
  canceled: 'Cancelado',
};

export const statusTone: Record<OrderStatus, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'accent',
  dispatched: 'success',
  canceled: 'danger',
};

export const eventLabel: Record<OrderEvent['type'], string> = {
  created: 'Rascunho criado',
  edited: 'Rascunho editado',
  confirmed: 'Pedido confirmado (estoque reservado)',
  dispatched: 'Pedido expedido (saída do estoque)',
  canceled: 'Pedido cancelado',
  due_date_changed: 'Vencimento corrigido',
};

/** "PED-1A2B3C4D" a partir do identificador comercial completo ("PED-<UUID>"). */
export function shortOrderId(commercialId: string): string {
  return commercialId.slice(0, 12);
}

/**
 * Prévia do subtotal da linha, com a mesma regra do servidor:
 * arredonda (preço em centavos × quantidade em milésimos) / 1000, meio para cima. BigInt evita
 * perda de precisão acima de 2^53.
 */
export function lineSubtotalPreview(unitPriceCents: number, quantityMilli: number): number {
  return Number((BigInt(unitPriceCents) * BigInt(quantityMilli) + 500n) / 1000n);
}

export type CartLine = {
  productId: string;
  name: string;
  sku: string;
  unit: Unit;
  /** Preço de tabela no momento da escolha (prévia; o servidor registra o oficial). */
  unitPriceCents: number;
  quantityMilli: number;
};

export function cartTotalPreview(lines: readonly CartLine[]): number {
  return lines.reduce((a, l) => a + lineSubtotalPreview(l.unitPriceCents, l.quantityMilli), 0);
}

/** Linhas no formato do contrato (`{ productId, quantity }`), sem repetir produto. */
export function toLinesInput(lines: readonly CartLine[]) {
  return lines.map((l) => ({ productId: l.productId, quantity: toApiQuantity(l.quantityMilli) }));
}

/** Carrinho a partir de um rascunho salvo (snapshots do servidor). */
export function cartFromOrder(order: Order): CartLine[] {
  return order.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku,
    unit: l.unit,
    unitPriceCents: l.unitPriceCents,
    quantityMilli: quantityToMilli(l.quantity),
  }));
}

function quantityToMilli(text: string): number {
  const [int = '0', frac = ''] = text.split('.');
  return Number(int) * 1000 + Number(frac.padEnd(3, '0'));
}

/* ---------- Ações permitidas ---------- */

export type OrderAction = 'edit' | 'confirm' | 'dispatch' | 'cancel';

/**
 * Ações que a interface oferece, espelhando as transições e permissões do backend:
 * rascunho → confirmar/editar/cancelar; confirmado → expedir/cancelar. Cancelar exige
 * `orders:all:manage` (administrador). O servidor continua sendo a autorização real.
 */
export function actionsFor(status: OrderStatus, permissions: readonly string[]): OrderAction[] {
  const can = (p: string) => permissions.includes(p);
  const out: OrderAction[] = [];
  if (status === 'draft') {
    if (can('orders:own:create')) out.push('edit');
    if (can('orders:own:confirm')) out.push('confirm');
    if (can('orders:all:manage')) out.push('cancel');
  } else if (status === 'confirmed') {
    if (can('orders:own:dispatch')) out.push('dispatch');
    if (can('orders:all:manage')) out.push('cancel');
  }
  return out;
}

/* ---------- Pagamento ---------- */

/** Data de hoje (AAAA-MM-DD) no fuso da empresa; sem fuso conhecido, no fuso do aparelho. */
export function todayIn(timeZone?: string, now = new Date()): string {
  try {
    if (timeZone) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const field = (name: string) => parts.find((p) => p.type === name)?.value ?? '';
      const text = `${field('year')}-${field('month')}-${field('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    }
  } catch {
    // Intl sem fusos: cai para o fuso do aparelho.
  }
  return localDate(now);
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Soma dias a uma data de calendário (AAAA-MM-DD), sem depender de fuso. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Vencimentos manuais: primeiro vencimento + N parcelas a cada X dias (2 a 12 parcelas). */
export function dueDatesFor(first: string, count: number, intervalDays: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i * intervalDays));
}

export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === text;
}

/** "10/11/2026" a partir de AAAA-MM-DD, sem conversão de fuso. */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** Lê "10/11/2026" (ou AAAA-MM-DD) digitado em data de calendário; null se inválido. */
export function parseCalendarDate(text: string): string | null {
  const t = text.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
  return isCalendarDate(iso) ? iso : null;
}

/** Resumo da condição registrada no pedido. */
export function paymentSummary(order: Pick<Order, 'payment' | 'paymentTerms'>): string {
  if (order.paymentTerms) return order.paymentTerms.name;
  if (!order.payment) return 'Não definida';
  return order.payment.type === 'cash'
    ? 'À vista'
    : `Parcelado em ${order.payment.dueDates.length} vezes`;
}

/* ---------- Execução financeira (somente leitura) ---------- */

export const executionStatusLabel: Record<FinancialExecution['status'], string> = {
  ACCEPTED: 'Aceita, aguardando processamento',
  INDEXING: 'Em processamento',
  PLANNING: 'Em processamento',
  SEALING: 'Em processamento',
  VALIDATING: 'Em processamento',
  READY: 'Pronta para aplicar',
  APPLYING: 'Aplicando',
  FINALIZABLE: 'Finalizando',
  PAUSED: 'Pausada',
  NEEDS_REVIEW: 'Precisa de revisão administrativa',
  COMPLETED: 'Concluída',
  ABORTED: 'Interrompida sem efeito',
};

/** Concluída só quando o servidor marca `financialCompleted`; 202 nunca é sucesso financeiro. */
/** Publicação exige todos os sinais do contrato F02. ABORTED é terminal, sem sucesso financeiro. */
export const executionPublished = (
  e: Pick<FinancialExecution, 'financialCompleted' | 'status'> &
    Partial<Pick<FinancialExecution, 'publishedAt' | 'result'>>,
) =>
  e.financialCompleted && e.status === 'COMPLETED' && Boolean(e.publishedAt) && Boolean(e.result);

export const executionDone = (
  e: Pick<FinancialExecution, 'financialCompleted' | 'status'> &
    Partial<Pick<FinancialExecution, 'publishedAt' | 'result'>>,
) => executionPublished(e) || e.status === 'ABORTED';

/* ---------- Escolha de pagamento no rascunho ---------- */

export type PaymentChoice =
  | { mode: 'later' }
  | { mode: 'condition'; conditionId: string }
  | {
      mode: 'manual';
      type: 'cash' | 'installments';
      first: string;
      count: number;
      interval: number;
    };

export function paymentChoiceOf(order: Order | undefined): PaymentChoice {
  if (order?.paymentTerms) return { mode: 'condition', conditionId: order.paymentTerms.id };
  if (order?.payment) {
    const dates = order.payment.dueDates;
    const interval =
      dates.length > 1
        ? Math.round(
            (new Date(`${dates[1]}T12:00:00Z`).getTime() -
              new Date(`${dates[0]}T12:00:00Z`).getTime()) /
              86_400_000,
          )
        : 30;
    return {
      mode: 'manual',
      type: order.payment.type,
      first: dates[0]!,
      count: dates.length,
      interval,
    };
  }
  return { mode: 'later' };
}

export function manualDueDates(choice: Extract<PaymentChoice, { mode: 'manual' }>): string[] {
  return choice.type === 'cash'
    ? [choice.first]
    : dueDatesFor(choice.first, choice.count, choice.interval);
}

type PaymentBody = Pick<
  OrderUpdate,
  | 'payment'
  | 'paymentConditionId'
  | 'paymentConditionVersion'
  | 'intendedPaymentMethodId'
  | 'intendedPaymentMethodVersion'
>;

/**
 * Parte de pagamento do corpo do rascunho, conforme o contrato: condição cadastrada (ID +
 * versão) OU calendário manual (`payment`), nunca os dois. Ao trocar para manual, a condição
 * anterior é limpa com `paymentConditionId: null`. Retorna o motivo quando a escolha é inválida.
 */
export function paymentBody(
  choice: PaymentChoice,
  conditions: readonly ConditionOption[],
  method: MethodOption | null,
  today: string,
): { ok: true; body: PaymentBody } | { ok: false; reason: string } {
  const methodPart: PaymentBody = method
    ? { intendedPaymentMethodId: method.id, intendedPaymentMethodVersion: method.version }
    : { intendedPaymentMethodId: null };
  if (choice.mode === 'later')
    return { ok: true, body: { paymentConditionId: null, payment: null, ...methodPart } };
  if (choice.mode === 'condition') {
    const condition = conditions.find((c) => c.id === choice.conditionId);
    if (!condition) return { ok: false, reason: 'A condição escolhida não está mais disponível.' };
    return {
      ok: true,
      body: {
        paymentConditionId: condition.id,
        paymentConditionVersion: condition.version,
        ...methodPart,
      },
    };
  }
  if (!isCalendarDate(choice.first))
    return { ok: false, reason: 'Informe o primeiro vencimento como DD/MM/AAAA.' };
  if (choice.first < today) return { ok: false, reason: 'O vencimento não pode ser no passado.' };
  if (choice.type === 'installments' && (choice.count < 2 || choice.count > 12))
    return { ok: false, reason: 'Parcelado precisa de 2 a 12 vencimentos.' };
  return {
    ok: true,
    body: {
      paymentConditionId: null,
      payment: { type: choice.type, dueDates: manualDueDates(choice) },
      ...methodPart,
    },
  };
}
