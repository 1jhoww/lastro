import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { StockAdmin, StockAvailability } from '@/api/types';
import { DetailColumns, Fact } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useInventoryItem, useMovements } from '@/features/inventory/api';
import { MovementTable } from '@/features/inventory/MovementTable';
import { BalanceFigures, qty, StockStatus } from '@/features/inventory/StockParts';
import { isAdminStock } from '@/features/inventory/stock';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { ListClock, Package, Plus, SlidersHorizontal } from '@/ui/icons';

export default function StockDetailRoute() {
  return (
    <RequirePermission title="Estoque" anyOf={['inventory:manage', 'inventory:available:read']}>
      <StockDetail />
    </RequirePermission>
  );
}

function StockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useInventoryItem(id);
  if (item.isPending) return <RecordLoading title="Estoque" />;
  if (item.isError || !item.data)
    return (
      <RecordError
        title="Estoque"
        error={item.error}
        backHref={'/estoque' as Href}
        backLabel="Voltar para o estoque"
        onRetry={() => item.refetch()}
      />
    );
  return isAdminStock(item.data) ? (
    <AdminStock stock={item.data} />
  ) : (
    <SellerStock stock={item.data} />
  );
}

/** Vendedor: só o disponível para vender, sem saldos internos nem ações. */
function SellerStock({ stock }: { stock: StockAvailability }) {
  return (
    <Screen title={stock.name} description={stock.sku}>
      <Panel title="Disponível para vender">
        <Text variant="figureLarge">{qty(stock.available, stock.unit)}</Text>
        <Text variant="small" color={color.textSecondary}>
          Já descontado o que está reservado para outros pedidos.
        </Text>
      </Panel>
      <View style={styles.links}>
        <Link href={`/produtos/${stock.productId}` as Href} asChild>
          <Button label="Ver ficha do produto" icon={Package} variant="outline" />
        </Link>
      </View>
    </Screen>
  );
}

function AdminStock({ stock }: { stock: StockAdmin }) {
  const { permissions } = useSession();
  const manage = permissions.includes('inventory:manage');
  const compact = useLayoutSize() === 'compact';
  const recent = useMovements({ productId: stock.productId, direction: 'desc' }, 10, manage);

  return (
    <Screen
      title={stock.name}
      description={`${stock.sku} · estoque`}
      actions={
        manage ? (
          <>
            <Link href={`/estoque/ajuste?produto=${stock.productId}` as Href} asChild>
              <Button
                label="Ajustar saldo"
                icon={SlidersHorizontal}
                variant="outline"
                fullWidth={compact}
              />
            </Link>
            <Link href={`/estoque/entrada?produto=${stock.productId}` as Href} asChild>
              <Button label="Registrar entrada" icon={Plus} variant="strong" fullWidth={compact} />
            </Link>
          </>
        ) : null
      }
    >
      {stock.status === 'inactive' ? (
        <Alert tone="warning" title="Produto inativo">
          Não entra em novos pedidos. O saldo e o histórico continuam disponíveis.
        </Alert>
      ) : null}
      <DetailColumns
        main={
          <>
            <Panel title="Saldos">
              <BalanceFigures stock={stock} />
            </Panel>
            <Panel
              title="Últimas movimentações"
              flush
              action={
                <Link href={`/estoque/movimentacoes?produto=${stock.productId}` as Href} asChild>
                  <Button label="Ver todas" icon={ListClock} size="sm" variant="outline" />
                </Link>
              }
            >
              {recent.query.isPending ? (
                <View style={styles.loading} accessibilityLabel="Carregando">
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="40%" />
                </View>
              ) : recent.query.isError ? (
                <View style={styles.inset}>
                  <Alert tone="danger" title="Não foi possível carregar o histórico">
                    {toApiError(recent.query.error).userMessage}
                  </Alert>
                </View>
              ) : recent.items.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={ListClock}
                  title="Sem movimentações"
                  description="O saldo deste produto ainda não foi movimentado."
                />
              ) : (
                <MovementTable rows={recent.items} showProduct={false} stacked />
              )}
            </Panel>
          </>
        }
        side={
          <Panel title="Registro do estoque">
            <View style={styles.facts}>
              <Fact label="Situação" value={<StockStatus stock={stock} />} />
              <Fact label="Unidade" value={stock.unit} />
              <Fact
                label="Última movimentação"
                value={stock.lastMovementAt ? formatDateTime(stock.lastMovementAt) : 'Nenhuma'}
              />
              <Link href={`/produtos/${stock.productId}` as Href} asChild>
                <Button label="Ver ficha do produto" icon={Package} variant="outline" />
              </Link>
            </View>
          </Panel>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row' },
  loading: { padding: space[5], gap: space[2] },
  inset: { padding: space[4] },
  facts: { gap: space[4], paddingTop: space[1] },
});
