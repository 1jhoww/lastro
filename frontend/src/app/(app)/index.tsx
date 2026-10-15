import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ClipboardList, Plus, Truck } from '@/ui/icons';
import { BelowMinimumPanel } from '@/features/inventory/BelowMinimumPanel';
import { OrderGlance } from '@/features/orders/OrderGlance';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { canCreateOrder } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { space, useLayoutSize } from '@/theme';
import { Button } from '@/ui';
import { FinanceGlance } from '@/features/finance/FinanceGlance';
import { canReadFinance } from '@/features/finance/FinanceAccess';

/**
 * Início: o que pede ação hoje. Sem gráficos decorativos e sem contadores globais (a API não
 * oferece totais; listas são paginadas por cursor).
 */
export default function Home() {
  const size = useLayoutSize();
  const session = useSession();
  const { permissions } = session;
  const tenant = useTenant();
  const seesInventory = permissions.includes('inventory:manage');
  const seesOrders =
    permissions.includes('orders:own:read') || permissions.includes('orders:all:manage');
  const wide = size === 'expanded';

  return (
    <Screen
      title="Início"
      description={
        tenant.data
          ? `${tenant.data.name}: o que precisa de atenção hoje.`
          : 'O que precisa de atenção hoje.'
      }
    >
      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={[styles.col, wide && styles.colMain]}>
          {seesOrders ? (
            <OrderGlance
              title="Pedidos recentes"
              description="Os últimos pedidos criados por você ou pela equipe."
              emptyIcon={ClipboardList}
              emptyTitle="Nenhum pedido para mostrar"
              action={
                canCreateOrder(permissions) ? (
                  <Link href="/pedidos/novo" asChild>
                    <Button label="Novo pedido" icon={Plus} variant="strong" />
                  </Link>
                ) : null
              }
            />
          ) : null}
        </View>
        <View style={[styles.col, wide && styles.colSide]}>
          {seesOrders ? (
            <OrderGlance
              title="Aguardando expedição"
              description="Confirmados, com estoque já reservado. Os mais antigos primeiro."
              status="confirmed"
              oldestFirst
              emptyIcon={Truck}
              emptyTitle="Nada aguardando expedição"
            />
          ) : null}
          {seesInventory ? <BelowMinimumPanel /> : null}
          {canReadFinance(session) ? <FinanceGlance /> : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space[5] },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
  colMain: { flex: 3 },
  colSide: { flex: 2 },
});
