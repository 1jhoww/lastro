import type { FinancialExecution, PaymentMethod, Receivable } from '@/api/types';
import { executionPublished, shortOrderId } from '@/features/orders/rules';
import { daysBetween, formatIsoDate } from '@/lib/calendar';
import type { BadgeTone } from '@/ui';
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  FileText,
  Landmark,
  QrCode,
  type LucideIcon,
} from '@/ui/icons';

/** Situação de cobrança apresentada à pessoa. Não cria estado financeiro novo: deriva do título. */
export type DueKey = 'overdue' | 'today' | 'upcoming' | 'paid' | 'canceled' | 'zero';

type TitleLike = Pick<Receivable, 'status' | 'outstandingCents' | 'dueDate'>;

export function dueKey(title: TitleLike, today: string | null): DueKey {
  if (title.status === 'canceled') return 'canceled';
  if (title.status === 'zero') return 'zero';
  if (title.outstandingCents === 0) return 'paid';
  if (!today) return 'upcoming';
  if (title.dueDate < today) return 'overdue';
  if (title.dueDate === today) return 'today';
  return 'upcoming';
}

export const dueLabels: Record<DueKey, { label: string; tone: BadgeTone }> = {
  overdue: { label: 'Vencido', tone: 'danger' },
  today: { label: 'Vence hoje', tone: 'warning' },
  upcoming: { label: 'A vencer', tone: 'neutral' },
  paid: { label: 'Quitado', tone: 'success' },
  canceled: { label: 'Cancelado', tone: 'neutral' },
  zero: { label: 'Sem valor', tone: 'neutral' },
};

/** "Venceu há 3 dias", "Vence amanhã", "Vence em 12 dias". Vazio para título sem saldo. */
export function dueHint(title: TitleLike, today: string | null): string {
  if (!today || title.outstandingCents === 0 || title.status === 'canceled') return '';
  const days = daysBetween(today, title.dueDate);
  if (days < -1) return `Venceu há ${-days} dias`;
  if (days === -1) return 'Venceu ontem';
  if (days === 0) return 'Vence hoje';
  if (days === 1) return 'Vence amanhã';
  return `Vence em ${days} dias`;
}

export const isPartial = (t: Pick<Receivable, 'cashCents' | 'creditCents' | 'outstandingCents'>) =>
  t.outstandingCents > 0 && t.cashCents + t.creditCents > 0;

/** Mesmo identificador curto que Pedidos mostra (PED- + início do ID). */
export function orderCode(orderId: string): string {
  return shortOrderId(`PED-${orderId.toUpperCase()}`);
}

export const installmentLabel = (n: number) => `${n}ª parcela`;

export const formatDate = (iso: string) => formatIsoDate(iso) || iso;

export const methodKinds: { value: PaymentMethod['kind']; label: string; icon: LucideIcon }[] = [
  { value: 'pix', label: 'Pix', icon: QrCode },
  { value: 'cash', label: 'Dinheiro', icon: Banknote },
  { value: 'transfer', label: 'Transferência', icon: Landmark },
  { value: 'card', label: 'Cartão', icon: CreditCard },
  { value: 'boleto', label: 'Boleto', icon: FileText },
  { value: 'other', label: 'Outra', icon: CircleDollarSign },
];
export const methodKindLabel = (kind: PaymentMethod['kind']) =>
  methodKinds.find((k) => k.value === kind)?.label ?? 'Outra';
export const methodIcon = (kind: PaymentMethod['kind']) =>
  methodKinds.find((k) => k.value === kind)?.icon ?? CircleDollarSign;

/** "30, 60 e 90 dias" / "À vista" para prazos de condição. */
export function describeOffsets(offsets: number[]): string {
  if (offsets.length === 1 && offsets[0] === 0) return 'À vista (no dia da confirmação)';
  const parts = offsets.map((d) => (d === 0 ? 'no dia' : String(d)));
  const joined =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
  return offsets.every((d) => d === 0) ? 'No dia da confirmação' : `${joined} dias`;
}

/** Proporção legível: "Partes iguais" ou "40% · 60%". */
export function describeWeights(weights: number[]): string {
  if (weights.every((w) => w === weights[0])) return 'Partes iguais';
  const total = weights.reduce((a, w) => a + w, 0);
  return weights.map((w) => `${formatPercent((w / total) * 100)}`).join(' · ');
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace('.', ',')}%`;
}

export { previewAmounts, previewDueDates } from './schedulePreview';

/** Comparação de nomes como o backend (sem acento, maiúsculas e espaços extras). */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

type ExecutionLike = Pick<FinancialExecution, 'status' | 'financialCompleted'> &
  Partial<Pick<FinancialExecution, 'publishedAt' | 'result'>>;

/**
 * Linguagem administrativa para operações retomáveis. O estado técnico continua disponível
 * no detalhe; "Concluída" exige publicação econômica comprovada (financialCompleted,
 * publishedAt e resultado), nunca apenas HTTP 202 ou status.
 */
export function executionStage(e: ExecutionLike): { label: string; tone: BadgeTone } {
  if (executionPublished(e)) return { label: 'Concluída', tone: 'success' };
  if (e.status === 'ABORTED') return { label: 'Interrompida sem efeito', tone: 'neutral' };
  if (e.status === 'PAUSED' || e.status === 'NEEDS_REVIEW')
    return { label: 'Necessita atenção', tone: 'danger' };
  if (e.status === 'COMPLETED') return { label: 'Aguardando confirmação', tone: 'warning' };
  return { label: 'Aguardando continuidade', tone: 'warning' };
}

export const executionKindLabel = (kind: FinancialExecution['kind']) =>
  kind === 'cancellation' ? 'Cancelamento de pedido' : 'Devolução de pedido';
