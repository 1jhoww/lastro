import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useOrder } from '@/features/orders/api';
import { OrderEditor } from '@/features/orders/OrderEditor';
import { shortOrderId, statusLabel } from '@/features/orders/rules';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { Alert, Button } from '@/ui';

export default function EditOrderRoute() {
  return (
    <RequirePermission title="Editar pedido" anyOf={['orders:own:create']}>
      <EditOrder />
    </RequirePermission>
  );
}

function EditOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrder(id);
  const [reloads, setReloads] = useState(0);
  if (order.isPending) return <RecordLoading title="Editar pedido" />;
  if (order.isError || !order.data)
    return (
      <RecordError
        title="Editar pedido"
        error={order.error}
        backHref={'/pedidos' as Href}
        backLabel="Voltar para pedidos"
        onRetry={() => order.refetch()}
      />
    );
  const o = order.data;
  const title = `Editar ${shortOrderId(o.commercialId)}`;
  if (o.status === 'draft')
    return (
      <OrderEditor
        key={`${o.id}:${reloads}`}
        title={title}
        description={o.customerName ?? undefined}
        order={o}
        onReload={() => order.refetch().then(() => setReloads((n) => n + 1))}
      />
    );
  return (
    <Screen title={title} description={o.customerName ?? undefined}>
      <Alert
        tone="warning"
        title={`Pedido ${statusLabel[o.status].toLowerCase()} não pode ser editado`}
        action={
          <Link href={`/pedidos/${o.id}` as Href} asChild>
            <Button label="Ver pedido" size="sm" variant="outline" />
          </Link>
        }
      >
        Só rascunhos aceitam alterações de cliente, itens ou pagamento.
      </Alert>
    </Screen>
  );
}
