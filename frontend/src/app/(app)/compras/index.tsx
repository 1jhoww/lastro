import { ManagementAccess } from '@/features/management/Parts';
import { PurchasesScreen } from '@/features/management/PurchasesScreen';

export default function Route() {
  return (
    <ManagementAccess permission="purchases:read" title="Compras">
      <PurchasesScreen />
    </ManagementAccess>
  );
}
