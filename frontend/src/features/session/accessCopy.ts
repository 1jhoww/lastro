import type { MembershipAccess } from '@/api/types';
import type { BadgeTone } from '@/ui';

/**
 * Textos dos estados de acesso de /me. `past_due` não aparece aqui: o backend o entrega como
 * `allowed` (o acesso continua) e não expõe a situação financeira da assinatura aos usuários da
 * empresa. Pagamento e reativação são feitos pela Hepta, fora do app.
 */
export const accessCopy: Record<
  Exclude<MembershipAccess, 'allowed'>,
  { label: string; tone: BadgeTone; title: string; body: string }
> = {
  suspended: {
    label: 'Acesso suspenso',
    tone: 'warning',
    title: 'O acesso desta empresa está suspenso',
    body: 'Os dados continuam guardados. O acesso volta quando a assinatura for reativada pela Hepta. Fale com o administrador da sua empresa.',
  },
  canceled: {
    label: 'Assinatura encerrada',
    tone: 'danger',
    title: 'A assinatura desta empresa foi encerrada',
    body: 'Esta empresa não tem mais acesso ao Lastro. Fale com o administrador da sua empresa.',
  },
  provisioning: {
    label: 'Em configuração',
    tone: 'neutral',
    title: 'Esta empresa ainda está sendo configurada',
    body: 'O acesso abre quando o primeiro administrador aceitar o convite dele.',
  },
};
