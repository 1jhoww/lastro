import { ManagementAccess } from '@/features/management/Parts';
import { useLocalSearchParams } from 'expo-router';
import { PurchaseDetail } from '@/features/management/PurchaseDetail';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ManagementAccess permission="purchases:read" title="Compra">
      <PurchaseDetail id={id} key={id} />
    </ManagementAccess>
  );
}
