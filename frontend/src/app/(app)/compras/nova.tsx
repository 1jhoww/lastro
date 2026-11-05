import { ManagementAccess } from '@/features/management/Parts';
import { PurchaseEditor } from '@/features/management/PurchaseEditor';
import { Screen } from '@/layout/Screen';

export default function Route() {
  return (
    <ManagementAccess permission="purchases:create" title="Nova compra">
      <Screen title="Nova compra" description="Fica em rascunho até você confirmar.">
        <PurchaseEditor />
      </Screen>
    </ManagementAccess>
  );
}
