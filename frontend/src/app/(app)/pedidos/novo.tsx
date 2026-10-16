import { OrderEditor } from '@/features/orders/OrderEditor';
import { RequirePermission } from '@/features/session/RequirePermission';

export default function NewOrderRoute() {
  return (
    <RequirePermission title="Novo pedido" anyOf={['orders:own:create']}>
      <OrderEditor
        title="Novo pedido"
        description="Cliente, produtos e pagamento em uma página. O pedido fica como rascunho até ser confirmado."
      />
    </RequirePermission>
  );
}
