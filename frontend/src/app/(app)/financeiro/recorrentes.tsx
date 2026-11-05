import { ManagementAccess } from '@/features/management/Parts';
import { RecurringScreen } from '@/features/management/RecurringScreen';

export default function Route() {
  return (
    <ManagementAccess permission="recurring:read" title="Despesas recorrentes">
      <RecurringScreen />
    </ManagementAccess>
  );
}
