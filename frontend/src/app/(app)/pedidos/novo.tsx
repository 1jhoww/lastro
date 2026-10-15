import { OrderEditor } from '@/features/orders/OrderEditor';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';

export default function NewOrderRoute() {
  return (
    <RequirePermission title="Novo pedido" anyOf={['orders:own:create']}>
      <Screen
        title="Novo pedido"
        description="Cliente, produtos e revisão. O pedido fica como rascunho até você confirmar."
      >
        <OrderEditor />
      </Screen>
    </RequirePermission>
  );
}
