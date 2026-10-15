import { Fragment, type ReactNode } from 'react';
import { useSession } from '@/session/SessionContext';
import { AccessDenied } from '@/features/session/RequirePermission';
export function ReportAccess({
  children,
  permission = 'reports:read',
}: {
  children: ReactNode;
  permission?: string;
}) {
  const session = useSession();
  if (
    session.role !== 'administrator' ||
    session.isPlatformAdmin ||
    !session.permissions.includes(permission)
  )
    return <AccessDenied title="Relatórios e catálogo" />;
  return <Fragment key={`${session.user?.uid}:${session.tenantId}`}>{children}</Fragment>;
}
