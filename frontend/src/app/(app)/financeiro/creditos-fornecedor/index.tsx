import { ManagementAccess } from '@/features/management/Parts';
import { SupplierCreditsScreen } from '@/features/management/SupplierCredits';

export default function Route() {
  return (
    <ManagementAccess permission="payables:read" title="Créditos de fornecedores">
      <SupplierCreditsScreen />
    </ManagementAccess>
  );
}
