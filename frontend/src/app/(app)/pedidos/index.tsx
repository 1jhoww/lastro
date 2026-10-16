import { useMemo, useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Order, OrderStatus } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { useOrderList, type OrderFilters } from '@/features/orders/api';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { shortOrderId, statusLabel, statusTone } from '@/features/orders/rules';
import { RequirePermission } from '@/features/session/RequirePermission';
import { shortId } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { canCreateOrder } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ChoiceChips,
  SearchField,
  Segmented,
  Text,
  type Column,
} from '@/ui';
import { ClipboardList, Plus, SearchX, X } from '@/ui/icons';

// Filtros que GET /orders aceita: situação, cliente e ordem por data. Não há busca textual.
type StatusFilter = 'all' | OrderStatus;
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'dispatched', label: 'Expedidos' },
  { value: 'canceled', label: 'Cancelados' },
];

export default function OrdersRoute() {
  return (
    <RequirePermission title="Pedidos" anyOf={['orders:all:manage', 'orders:own:read']}>
      <Orders />
    </RequirePermission>
  );
}

function Orders() {
  const { permissions, user } = useSession();
  const params = useLocalSearchParams<{ situacao?: string }>();
  const initial = statusOptions.some((o) => o.value === params.situacao)
    ? (params.situacao as StatusFilter)
    : 'all';
  const [status, setStatus] = useState<StatusFilter>(initial);
  const [direction, setDirection] = useState<'desc' | 'asc'>('desc');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [numberSearch, setNumberSearch] = useState('');
  const size = useLayoutSize();
  const compact = size === 'compact';
  const admin = permissions.includes('orders:all:manage');
  const create = canCreateOrder(permissions);

  const filters = useMemo<OrderFilters>(
    () => ({
      direction,
      ...(status !== 'all' ? { status } : {}),
      ...(customer ? { customerId: customer.id } : {}),
    }),
    [direction, status, customer],
  );
  const { query, items } = useOrderList(filters);
  const who = (uid: string) => (uid === user?.uid ? 'Você' : `Vendedor ${shortId(uid)}`);

  const columns: Column<Order>[] = [
    {
      key: 'id',
      label: 'Pedido',
      width: 130,
      render: (o) => <Text variant="bodyStrong">{shortOrderId(o.commercialId)}</Text>,
    },
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (o) => (
        <Text variant="body" numberOfLines={1}>
          {o.customerName ?? 'Sem cliente'}
        </Text>
      ),
    },
    {
      key: 'date',
      label: 'Criado em',
      width: 140,
      render: (o) => <Text variant="small">{formatDateTime(o.createdAt)}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 120,
      render: (o) => (
        <View style={{ gap: 4 }}>
          <Badge label={statusLabel[o.status]} tone={statusTone[o.status]} />
          {o.status === 'confirmed' ? <Text variant="caption">Aguardando saída</Text> : null}
        </View>
      ),
    },
    ...(admin
      ? [
          {
            key: 'seller',
            label: 'Responsável',
            width: 150,
            render: (o: Order) => (
              <Text variant="small" color={color.textSecondary}>
                {who(o.sellerUid)}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'total',
      label: 'Total',
      width: 130,
      align: 'right',
      render: (o) => <Text variant="figure">{formatCents(o.totalCents)}</Text>,
    },
  ];

  const visibleItems = items.filter((o) =>
    o.commercialId.toLocaleLowerCase().includes(numberSearch.trim().toLocaleLowerCase()),
  );
  const filtered = status !== 'all' || customer !== null || !!numberSearch.trim();

  return (
    <Screen
      title="Pedidos"
      description={
        admin ? 'Todos os pedidos da empresa.' : 'Seus pedidos com clientes da sua carteira.'
      }
      actions={
        // No celular o botão central da barra inferior já cria pedidos.
        create && !compact ? (
          <Link href="/pedidos/novo" asChild>
            <Button label="Novo pedido" icon={Plus} />
          </Link>
        ) : null
      }
    >
      <ChoiceChips
        label="Situação do pedido"
        options={statusOptions}
        value={status}
        onChange={setStatus}
      />
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        {customer ? (
          <View style={styles.chip}>
            <Text variant="smallStrong" numberOfLines={1} style={styles.flex}>
              {`Cliente: ${customer.name}`}
            </Text>
            <Button
              label="Remover"
              icon={X}
              size="sm"
              variant="ghost"
              onPress={() => setCustomer(null)}
            />
          </View>
        ) : (
          <Button label="Filtrar por cliente" variant="outline" onPress={() => setPicking(true)} />
        )}
        <Segmented<'desc' | 'asc'>
          label="Ordem"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'desc', label: 'Mais recentes' },
            { value: 'asc', label: 'Mais antigos' },
          ]}
        />
      </View>

      <SearchField
        label="Número nos pedidos carregados"
        value={numberSearch}
        onChangeText={setNumberSearch}
        placeholder="Número comercial do pedido"
      />
      <Text variant="caption" color={color.textSecondary}>
        Busca por número nos {items.length} pedidos carregados. Carregue mais para ampliar; o filtro
        por cliente consulta todos os pedidos.
      </Text>
      <ListPanel
        query={query}
        count={visibleItems.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum pedido nesses filtros"
              description="Mude a situação, o cliente ou o número buscado."
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum pedido ainda"
              description="Crie o primeiro pedido escolhendo o cliente e os produtos. Ele fica como rascunho até você confirmar."
              action={
                create ? (
                  <Link href="/pedidos/novo" asChild>
                    <Button label="Novo pedido" variant="strong" icon={Plus} />
                  </Link>
                ) : null
              }
            />
          )
        }
      >
        <DataTable
          label="Pedidos"
          rows={visibleItems}
          keyOf={(o) => o.id}
          hrefOf={(o) => `/pedidos/${o.id}` as Href}
          columns={columns}
          renderCompact={(o) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {o.customerName ?? 'Sem cliente'}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {`${shortOrderId(o.commercialId)} · ${formatDateTime(o.createdAt)}`}
                </Text>
                <View style={styles.badge}>
                  <Badge label={statusLabel[o.status]} tone={statusTone[o.status]} />
                </View>
                <Text variant="caption" color={color.textSecondary}>
                  {o.status === 'confirmed'
                    ? 'Aguardando saída'
                    : o.status === 'draft'
                      ? 'Revisar e confirmar'
                      : o.status === 'dispatched'
                        ? 'Consultar saída e devoluções'
                        : 'Consultar histórico'}
                </Text>
                {admin ? <Text variant="caption">{who(o.sellerUid)}</Text> : null}
              </View>
              <Text variant="figure">{formatCents(o.totalCents)}</Text>
            </View>
          )}
        />
      </ListPanel>

      <CustomerPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCustomer({ id: c.id, name: c.name });
          setPicking(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: 10,
    backgroundColor: color.surface,
    minWidth: 240,
    flexShrink: 1,
  },
  flex: { flex: 1, minWidth: 0 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  badge: { flexDirection: 'row', paddingTop: space[1] },
});
