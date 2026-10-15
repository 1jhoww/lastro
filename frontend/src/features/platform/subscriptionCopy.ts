import type { SubscriptionStatus } from '@/api/types';
import type { BadgeTone } from '@/ui';

/** Situações reais da assinatura (backend). `past_due` mantém o acesso no MVP. */
export const subscriptionCopy: Record<
  SubscriptionStatus,
  { label: string; tone: BadgeTone; access: string }
> = {
  active: { label: 'Ativa', tone: 'success', access: 'Acesso liberado.' },
  past_due: {
    label: 'Em atraso',
    tone: 'warning',
    access: 'Acesso mantido enquanto a cobrança é regularizada.',
  },
  suspended: {
    label: 'Suspensa',
    tone: 'danger',
    access: 'Acesso bloqueado; os dados ficam preservados.',
  },
  canceled: { label: 'Cancelada', tone: 'strong', access: 'Encerrada. Não pode ser reativada.' },
};
