import { ManagementAccess } from '@/features/management/Parts';
import { ManagementDashboard } from '@/features/management/ManagementDashboard';

export default function Route() {
  return (
    <ManagementAccess permission="financial-reports:read" title="Painel de gestão">
      <ManagementDashboard />
    </ManagementAccess>
  );
}
