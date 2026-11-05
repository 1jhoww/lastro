import { ManagementAccess } from '@/features/management/Parts';
import { RecurringScreen } from '@/features/management/RecurringScreen';

export default function Route() {
  return (
    <ManagementAccess permission="payables:read" title="Despesas recorrentes">
      <RecurringScreen />
    </ManagementAccess>
  );
}
