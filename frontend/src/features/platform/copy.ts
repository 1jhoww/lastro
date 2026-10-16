import type { ChargeSituation, PlanCode, PlanFeature } from '@/api/types';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import type { BadgeTone } from '@/ui';

/** Nome exibido do plano; contratos anteriores ao catálogo oficial aparecem como legado. */
export function planLabel(code: PlanCode | null, name?: string | null): string {
  if (name) return name;
  if (code === 'essencial') return 'Essencial';
  if (code === 'profissional') return 'Profissional';
  return 'Legado';
}

/** Mesmos textos do catálogo do backend, para telas que só recebem o código do recurso. */
export const featureLabel: Record<PlanFeature, string> = {
  'users.invite': 'Convite de usuários adicionais',
  'catalog.public': 'Catálogo / vitrine virtual',
  'commercial.sellers': 'Vendedores e carteiras de clientes',
};

/** Situação financeira da cobrança. Vencida e próxima são alertas, nunca bloqueio de acesso. */
export const chargeCopy: Record<ChargeSituation, { label: string; tone: BadgeTone }> = {
  overdue: { label: 'Vencida', tone: 'danger' },
  due_soon: { label: 'Vence em breve', tone: 'warning' },
  pending: { label: 'Em aberto', tone: 'neutral' },
  paid: { label: 'Paga', tone: 'success' },
  canceled: { label: 'Cancelada', tone: 'strong' },
};

/** "2026-10" vira "out/2026". */
export function competenceLabel(competence: string): string {
  const [year, month] = competence.split('-');
  const names = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `${names[Number(month) - 1] ?? month}/${year}`;
}

export const dateOrDash = (value: string | null | undefined) =>
  value ? formatIsoDate(value) : '—';

export function seatsLabel(active: number, limit: number): string {
  return `${active} de ${limit} ${limit === 1 ? 'usuário' : 'usuários'}`;
}

/** Descrição de uma entrada do histórico auditado (assinatura ou cobrança). */
export function historyLabel(action: string, changes: Record<string, unknown>): string {
  const reason = typeof changes.reason === 'string' ? ` Motivo: ${changes.reason}` : '';
  const cents = (value: unknown) => (typeof value === 'number' ? formatCents(value) : '—');
  switch (action) {
    case 'tenant.created':
      return `Empresa criada no plano ${planLabel((changes.planCode as PlanCode) ?? null)}, ${cents(changes.monthlyPriceCents)} por mês.`;
    case 'subscription.plan.changed':
      return `Plano alterado de ${planLabel((changes.previousPlanCode as PlanCode) ?? null)} para ${planLabel((changes.planCode as PlanCode) ?? null)}; valor ${cents(changes.previousMonthlyPriceCents)} → ${cents(changes.monthlyPriceCents)}.${reason}`;
    case 'subscription.activated':
      return `Cobrança ativada: ${cents(changes.monthlyPriceCents)} por mês, vencimento dia ${String(changes.billingDay)}, a partir de ${dateOrDash(changes.billingStartsOn as string)}.${reason}`;
    case 'subscription.terms.updated':
      return `Condições ajustadas.${reason}`;
    case 'subscription.suspended':
      return `Assinatura suspensa.${reason}`;
    case 'subscription.reactivated':
      return `Assinatura reativada.${reason}`;
    case 'subscription.migrated':
      return 'Migrada para os planos oficiais.';
    case 'subscription.updated':
      return `Condições alteradas (registro anterior ao catálogo oficial).${reason}`;
    case 'tenant.owner.invitation.renewed':
      return 'Convite do primeiro administrador renovado.';
    case 'charge.generated':
      return `Cobrança gerada automaticamente: ${cents(changes.amountCents)}, vencimento ${dateOrDash(changes.dueDate as string)}.`;
    case 'charge.created':
      return `Cobrança manual criada: ${cents(changes.amountCents)}, vencimento ${dateOrDash(changes.dueDate as string)}.${reason}`;
    case 'charge.paid':
      return `Pagamento registrado: ${cents(changes.paidAmountCents)} em ${dateOrDash(changes.paidAt as string)}.`;
    case 'charge.corrected':
      return `Registro corrigido.${reason}`;
    case 'charge.canceled':
      return `Cobrança cancelada.${reason}`;
    default:
      return action;
  }
}
