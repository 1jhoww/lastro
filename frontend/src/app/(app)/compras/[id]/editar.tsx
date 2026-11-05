import { useLocalSearchParams } from 'expo-router';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { usePurchase } from '@/features/management/api';
import { ManagementAccess } from '@/features/management/Parts';
import { PurchaseEditor } from '@/features/management/PurchaseEditor';
import { purchaseCode } from '@/features/management/presentation';
import { Screen } from '@/layout/Screen';

function Editor({ id }: { id: string }) {
  const purchase = usePurchase(id);
  if (purchase.isPending) return <RecordLoading title="Editar compra" />;
  if (purchase.isError || !purchase.data)
    return (
      <RecordError
        title="Editar compra"
        error={purchase.error}
        backHref="/compras"
        backLabel="Voltar para compras"
        onRetry={() => purchase.refetch()}
      />
    );
  return (
    <Screen title="Editar compra" description={purchaseCode(purchase.data)}>
      <PurchaseEditor key={purchase.data.version} purchase={purchase.data} />
    </Screen>
  );
}

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ManagementAccess permission="purchases:edit" title="Editar compra">
      <Editor id={id} />
    </ManagementAccess>
  );
}
