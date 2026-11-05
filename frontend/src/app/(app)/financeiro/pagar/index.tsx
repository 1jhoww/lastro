import { ManagementAccess } from '@/features/management/Parts';
import { PayablesScreen } from '@/features/management/PayablesScreen';

export default function Route() {
  return (
    <ManagementAccess permission="payables:read" title="Contas a pagar">
      <PayablesScreen />
    </ManagementAccess>
  );
}
