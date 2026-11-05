import { useLocalSearchParams } from 'expo-router';
import { ManagementAccess } from '@/features/management/Parts';
import { SupplierCreditDetail } from '@/features/management/SupplierCredits';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ManagementAccess permission="payables:read" title="Crédito de fornecedor">
      <SupplierCreditDetail id={id} />
    </ManagementAccess>
  );
}
