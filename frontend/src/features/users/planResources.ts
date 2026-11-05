import type { MembershipPlan } from '@/api/types';
import { featureLabel } from '@/features/platform/copy';

/** Módulos base do contrato, cada um reconhecido por uma permissão que o libera. */
const baseModules = [
  { label: 'Clientes e pedidos', permission: 'orders:all:manage' },
  { label: 'Produtos e estoque', permission: 'inventory:manage' },
  { label: 'Contas a receber', permission: 'receivables:read' },
  { label: 'Relatórios comerciais', permission: 'reports:read' },
  { label: 'Empresa e equipe', permission: 'users:manage' },
] as const;

/**
 * O que o contrato da empresa inclui, a partir do que o backend liberou (`permissions` e
 * `plan.features` do /me). Nunca cita o que falta: recurso indisponível simplesmente não aparece.
 */
export function contractedResources(
  plan: Pick<MembershipPlan, 'features'>,
  permissions: readonly string[],
): string[] {
  return [
    ...baseModules.filter((m) => permissions.includes(m.permission)).map((m) => m.label),
    ...plan.features.flatMap((f) => featureLabel[f] ?? []),
  ];
}
