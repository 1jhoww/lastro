import { useEffect, useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Receivable } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { CustomerPicker } from '@/features/orders/CustomerPicker';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { addDays } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { color, space, useLayoutSize } from '@/theme';
import { Button, DataTable, DateField, EmptyState, Text, type Column } from '@/ui';
import { CalendarClock, CircleDollarSign, UserRound, X } from '@/ui/icons';
import { useReceivables, type ReceivableFilters } from './api';
import { DueBadge, Guidance, FilterTabs } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import { dueHint, formatDate, installmentLabel, orderCode } from './presentation';
import { useRefetchStaleOnFocus } from './cacheUpdates';

type View_ = 'open' | 'overdue' | 'paid' | 'all';
const views: { value: View_; label: string }[] = [
  { value: 'open', label: 'A receber' },
  { value: 'overdue', label: 'Vencidos' },
  { value: 'paid', label: 'Quitados' },
  { value: 'all', label: 'Todos' },
];
/** Páginas lidas automaticamente quando o filtro local esconde a maior parte dos títulos. */
const AUTO_PAGES = 10;

export function ReceivablesScreen() {
  const params = useLocalSearchParams<{ pedido?: string; situacao?: string }>();
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : null;
  const size = useLayoutSize();
  const compact = size === 'compact';
  const wide = size === 'expanded';
  const [view, setView] = useState<View_>(
    views.some((v) => v.value === params.situacao) ? (params.situacao as View_) : 'open',
  );
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [showPeriod, setShowPeriod] = useState(false);
  const orderId = params.pedido ?? '';
  const yesterday = today ? addDays(today, -1) : '';
  const invalidPeriod = Boolean(period.from && period.to && period.from > period.to);
  const from = invalidPeriod ? '' : period.from;
  const until = invalidPeriod ? '' : period.to;
  // Vencidos: o servidor já limita até ontem; saldo positivo é conferido na tela.
  const to = view === 'overdue' ? (until && until < yesterday ? until : yesterday) : until;
  const filters: ReceivableFilters = {
    ...(orderId ? { orderId } : {}),
    ...(customer ? { customerId: customer.id } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(view === 'paid' ? { status: 'paid' as const } : {}),
  };
  const { query, items } = useReceivables(filters);
  useRefetchStaleOnFocus(query);
  const rows = items.filter((t) =>
    view === 'open' || view === 'overdue' ? t.outstandingCents > 0 : true,
  );
  const pages = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (rows.length < 10 && query.hasNextPage && !query.isFetching && pages < AUTO_PAGES)
      query.fetchNextPage();
  }, [rows.length, query, pages]);

  const allColumns: Column<Receivable>[] = [
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (t) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {t.customerName}
          </Text>
          <Text variant="small" color={color.textSecondary}>
            {orderCode(t.orderId)}
          </Text>
        </View>
      ),
    },
    {
      key: 'installment',
      label: 'Parcela',
      width: 72,
      render: (t) => <Text>{`${t.installmentNumber}ª`}</Text>,
    },
    {
      key: 'due',
      label: 'Vencimento',
      flex: 2,
      render: (t) => (
        <View>
          <Text>{formatDate(t.dueDate)}</Text>
          <Text variant="small" color={color.textSecondary}>
            {dueHint(t, today)}
          </Text>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Situação',
      flex: 2,
      render: (t) => <DueBadge title={t} today={today} />,
    },
    {
      key: 'original',
      label: 'Valor',
      width: 120,
      align: 'right',
      render: (t) => <Text>{formatCents(t.originalCents)}</Text>,
    },
    {
      key: 'received',
      label: 'Recebido',
      width: 120,
      align: 'right',
      render: (t) => (
        <Text color={t.cashCents + t.creditCents ? color.text : color.textSecondary}>
          {formatCents(t.cashCents + t.creditCents)}
        </Text>
      ),
    },
    {
      key: 'balance',
      label: 'Saldo',
      width: 130,
      align: 'right',
      render: (t) => (
        <View style={styles.amount}>
          <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
          {!wide && t.outstandingCents !== t.originalCents ? (
            <Text variant="caption" color={color.textSecondary}>
              {`de ${formatCents(t.originalCents)}`}
            </Text>
          ) : null}
        </View>
      ),
    },
  ];
  // Larguras intermediárias: valor original aparece sob o saldo, sem espremer o nome do cliente.
  const columns = wide
    ? allColumns
    : allColumns.filter((c) => c.key !== 'original' && c.key !== 'received');

  return (
    <Screen
      title="Contas a receber"
      description="Parcelas dos pedidos confirmados. Abra uma parcela para registrar o pagamento."
    >
      <FinanceNav />
      <View style={styles.filters}>
        <FilterTabs label="Situação" options={views} value={view} onChange={setView} />
        <View style={[styles.filterActions, compact && styles.filterActionsCompact]}>
          <Button
            label={customer ? customer.name : 'Cliente'}
            icon={UserRound}
            size="sm"
            variant={customer ? 'strong' : 'outline'}
            onPress={() => setPicking(true)}
          />
          {customer ? (
            <Button
              label="Todos os clientes"
              icon={X}
              size="sm"
              variant="ghost"
              onPress={() => setCustomer(null)}
            />
          ) : null}
          <Button
            label={period.from || period.to ? periodLabel(period) : 'Período'}
            icon={CalendarClock}
            size="sm"
            variant={period.from || period.to ? 'strong' : 'outline'}
            onPress={() => setShowPeriod((v) => !v)}
          />
        </View>
      </View>
      {showPeriod ? (
        <View style={[styles.period, compact && styles.periodCompact]}>
          <View style={styles.flex}>
            <DateField
              label="Vencimento de"
              value={period.from}
              today={today ?? undefined}
              onChange={(from) => setPeriod((p) => ({ ...p, from }))}
            />
          </View>
          <View style={styles.flex}>
            <DateField
              label="Vencimento até"
              value={period.to}
              today={today ?? undefined}
              min={period.from || undefined}
              onChange={(v) => setPeriod((p) => ({ ...p, to: v }))}
              error={invalidPeriod ? 'Fim antes do início' : undefined}
            />
          </View>
          <Button
            label="Limpar período"
            size="sm"
            variant="ghost"
            onPress={() => setPeriod({ from: '', to: '' })}
          />
        </View>
      ) : null}
      {orderId ? (
        <View style={styles.chip}>
          <Text variant="smallStrong">{`Somente ${orderCode(orderId)}`}</Text>
          <Button
            label="Ver todos os pedidos"
            icon={X}
            size="sm"
            variant="ghost"
            onPress={() => router.setParams({ pedido: '' } as never)}
          />
        </View>
      ) : null}
      <ListPanel
        query={query}
        count={rows.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title={
              query.hasNextPage
                ? 'Nenhum título nestes filtros até aqui'
                : 'Nenhum título nestes filtros'
            }
            description={
              query.hasNextPage
                ? 'Há mais parcelas para consultar. Use “Carregar mais” para continuar.'
                : 'Parcelas surgem quando um pedido é confirmado.'
            }
          />
        }
      >
        <DataTable
          label="Contas a receber"
          rows={rows}
          keyOf={(t) => t.id}
          hrefOf={(t) => `/financeiro/${t.id}` as Href}
          columns={columns}
          renderCompact={(t) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {t.customerName}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${installmentLabel(t.installmentNumber)} · ${orderCode(t.orderId)}`}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${formatDate(t.dueDate)}${dueHint(t, today) ? ` · ${dueHint(t, today)}` : ''}`}
                </Text>
                <DueBadge title={t} today={today} />
              </View>
              <View style={styles.amount}>
                <Text variant="figure">{formatCents(t.outstandingCents)}</Text>
                {t.outstandingCents !== t.originalCents ? (
                  <Text variant="caption" color={color.textSecondary}>
                    {`de ${formatCents(t.originalCents)}`}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        />
      </ListPanel>
      <Guidance>
        Pagamento parcial mantém a parcela em aberto com o saldo restante. A lista segue a ordem de
        vencimento.
      </Guidance>
      <CustomerPicker
        visible={picking}
        includeInactive
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCustomer({ id: c.id, name: c.name });
          setPicking(false);
        }}
      />
    </Screen>
  );
}

function periodLabel(p: { from: string; to: string }) {
  if (p.from && p.to) return `${formatDate(p.from)} a ${formatDate(p.to)}`;
  if (p.from) return `Desde ${formatDate(p.from)}`;
  return `Até ${formatDate(p.to)}`;
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  filterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  filterActionsCompact: { width: '100%' },
  period: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[3],
    padding: space[4],
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
    marginTop: -space[2],
  },
  periodCompact: { flexDirection: 'column', alignItems: 'stretch' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[2] },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  amount: { alignItems: 'flex-end' },
});
