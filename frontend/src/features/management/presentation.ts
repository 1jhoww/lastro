import type {
  Payable,
  Purchase,
  PurchaseClosureBody,
  PurchaseLine,
  RecurringExpense,
  SupplierCredit,
} from '@/api/types';
import { fromApiQuantity, type Unit } from '@/lib/quantity';
import type { BadgeTone } from '@/ui';

export const purchaseStatusCopy: Record<Purchase['status'], { label: string; tone: BadgeTone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  confirmed: { label: 'Confirmada', tone: 'accent' },
  partially_received: { label: 'Parcialmente recebida', tone: 'warning' },
  received: { label: 'Recebida', tone: 'success' },
  closed: { label: 'Encerrada com saldo', tone: 'neutral' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
};
export const closureTreatmentCopy: Record<
  PurchaseClosureBody['treatment'],
  { label: string; hint: string }
> = {
  abatement: {
    label: 'Abater dos títulos',
    hint: 'Reduz os títulos em aberto, a partir do último vencimento.',
  },
  full_charge: {
    label: 'Cobrança integral',
    hint: 'Os títulos continuam iguais: o fornecedor cobra também o que não entregou.',
  },
  supplier_credit: {
    label: 'Crédito do fornecedor',
    hint: 'Os títulos continuam iguais e o valor fica como crédito para usar depois.',
  },
};
export const supplierCreditKindCopy: Record<SupplierCredit['kind'], string> = {
  credit: 'Crédito do fornecedor',
  recoverable: 'Valor a recuperar',
};
export const purchaseCode = (p: Pick<Purchase, 'commercialId'>) => `#${p.commercialId}`;

export const situationCopy: Record<Payable['situation'], { label: string; tone: BadgeTone }> = {
  open: { label: 'Em aberto', tone: 'neutral' },
  partially_paid: { label: 'Parcialmente pago', tone: 'accent' },
  paid: { label: 'Pago', tone: 'success' },
  overdue: { label: 'Vencido', tone: 'danger' },
  canceled: { label: 'Cancelado', tone: 'neutral' },
};
export const originCopy: Record<Payable['origin'], string> = {
  purchase: 'Compra',
  expense: 'Despesa avulsa',
  recurring: 'Despesa recorrente',
  manual: 'Lançamento manual',
};
export const frequencyCopy: Record<RecurringExpense['frequency'], string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};
export const recurringStatusCopy: Record<
  RecurringExpense['status'],
  { label: string; tone: BadgeTone }
> = {
  active: { label: 'Ativa', tone: 'success' },
  paused: { label: 'Pausada', tone: 'warning' },
  ended: { label: 'Encerrada', tone: 'neutral' },
};
export const purchaseEventCopy: Record<string, string> = {
  created: 'Rascunho criado',
  edited: 'Rascunho editado',
  confirmed: 'Compra confirmada',
  amended: 'Compra alterada',
  reopened: 'Voltou a rascunho',
  received: 'Mercadoria recebida',
  receipt_reversed: 'Recebimento estornado',
  closed: 'Saldo pendente encerrado',
  canceled: 'Compra cancelada',
};
export const costEventCopy: Record<string, string> = {
  reference_updated: 'Custo de referência alterado',
  purchase_received: 'Recebimento de compra',
  receipt_reversed: 'Estorno de recebimento',
};
/** "47,14%" a partir de pontos base. */
export function formatMargin(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(2).replace('.', ',')}%`;
}
export const lineUnit = (line: Pick<PurchaseLine, 'unit'>) => line.unit as Unit;
export const pendingMilli = (line: Pick<PurchaseLine, 'pendingQuantity'>) =>
  fromApiQuantity(line.pendingQuantity);

/* ---------- Prévia do formulário; o valor oficial sempre vem do servidor. ---------- */

export type DraftLine = { milli: number; unitCostCents: number; discountCents: number };
export const lineSubtotal = (line: Pick<DraftLine, 'milli' | 'unitCostCents'>) =>
  Math.round((line.unitCostCents * line.milli) / 1000);
export function draftTotals(
  lines: readonly DraftLine[],
  extras: { freightCents: number; otherCostsCents: number; discountCents: number },
) {
  const subtotalCents = lines.reduce((a, l) => a + lineSubtotal(l), 0);
  const lineDiscountCents = lines.reduce((a, l) => a + l.discountCents, 0);
  return {
    subtotalCents,
    lineDiscountCents,
    totalCents:
      subtotalCents -
      lineDiscountCents +
      extras.freightCents +
      extras.otherCostsCents -
      extras.discountCents,
  };
}
export const installmentsTotal = (rows: readonly { amountCents: number }[]) =>
  rows.reduce((a, r) => a + r.amountCents, 0);

/** Mensagens das recusas do servidor que pedem uma decisão de quem está usando a tela. */
export const managementMessages: Record<string, string> = {
  PURCHASE_HAS_RECEIPTS:
    'Esta compra tem mercadoria recebida. Estorne os recebimentos antes de continuar.',
  PURCHASE_HAS_PAYMENTS:
    'Esta compra tem títulos pagos. Estorne os pagamentos em Contas a pagar antes de continuar.',
  PURCHASE_HAS_CREDITS:
    'Esta compra usou crédito do fornecedor. Estorne o uso do crédito antes de continuar.',
  PURCHASE_ALREADY_CLOSED: 'O saldo desta compra já foi encerrado.',
  PURCHASE_CLOSED: 'Compra com saldo encerrado não permite estornar recebimentos.',
  CLOSURE_VALUES_CHANGED: 'Os valores mudaram desde a prévia. Feche esta janela e revise.',
  EXCESS_DESTINATION_REQUIRED: 'Diga como o valor pago a maior fica registrado.',
  CREDIT_EXCEEDS_BALANCE: 'O valor passa do saldo do crédito.',
  CREDIT_TITLE_MISMATCH: 'O crédito só compensa títulos de compra do mesmo fornecedor.',
  RECEIPT_EXCEEDS_PENDING: 'A quantidade passa do que falta receber.',
  INSTALLMENTS_TOTAL_MISMATCH: 'A soma das parcelas precisa ser igual ao total da compra.',
  PAYMENT_TERMS_CHANGED: 'A condição de pagamento mudou. Escolha de novo no rascunho.',
  PAYMENT_EXCEEDS_BALANCE: 'O valor passa do saldo em aberto do título.',
  PAYABLE_HAS_PAYMENTS: 'Estorne os pagamentos deste título antes de continuar.',
  PAYABLE_ORIGIN_LOCKED: 'Título de compra é alterado pela própria compra.',
  INSUFFICIENT_STOCK: 'Parte desse estoque já foi reservada ou expedida. Estorno não realizado.',
  SUPPLIER_INACTIVE: 'Este fornecedor está inativo.',
  SUPPLIER_REQUIRED: 'Escolha o fornecedor antes de confirmar.',
  PURCHASE_LINES_REQUIRED: 'Inclua ao menos um produto antes de confirmar.',
  PAYMENT_CONDITION_REQUIRED: 'Escolha a condição de pagamento antes de confirmar.',
  ORDER_TOTAL_REQUIRED: 'O total da compra precisa ser maior que zero.',
  DUPLICATE_CATEGORY: 'Já existe uma categoria com este nome.',
};
