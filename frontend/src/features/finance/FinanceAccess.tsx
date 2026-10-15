import { Fragment, type ReactNode } from 'react';
import { AccessDenied } from '@/features/session/RequirePermission';
import { useSession } from '@/session/SessionContext';
import { FinancialRecovery } from './FinancialRecovery';

/** Remonta formulários na troca de empresa/ator, sem reutilizar seleção ou corpo anterior. */
export function FinanceAccess({
  children,
  permission = 'receivables:read',
}: {
  children: ReactNode;
  permission?: string;
}) {
  const session = useSession();
  if (!canManageFinance(session, permission)) return <AccessDenied title="Financeiro" />;
  return (
    <Fragment key={`${session.user?.uid}:${session.tenantId}`}>
      <FinancialRecovery>{children}</FinancialRecovery>
    </Fragment>
  );
}

export function canManageFinance(
  session: {
    role: string | null;
    isPlatformAdmin: boolean;
    permissions: readonly string[];
  },
  permission: string,
) {
  return (
    session.role === 'administrator' &&
    !session.isPlatformAdmin &&
    session.permissions.includes(permission)
  );
}

export const canReadFinance = (session: Parameters<typeof canManageFinance>[0]) =>
  canManageFinance(session, 'receivables:read');
