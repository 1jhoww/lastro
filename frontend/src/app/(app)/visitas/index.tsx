import { useMemo, useState } from 'react';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Visit, VisitSource } from '@/api/types';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { useCustomer } from '@/features/customers/api';
import { shortOrderId } from '@/features/orders/rules';
import { memberLabel, useMembers } from '@/features/users/api';
import { useVisitList, type VisitFilters } from '@/features/visits/api';
import { VisitsNav } from '@/features/visits/VisitsNav';
import { formatDay, kindLabel, personLabel, sourceCopy } from '@/features/visits/presentation';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  DataTable,
  DateField,
  EmptyState,
  Segmented,
  Select,
  Text,
  type Column,
} from '@/ui';
import { CalendarCheck, Plus, SearchX, X } from '@/ui/icons';

type SourceFilter = 'all' | VisitSource;
const sourceOptions: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'manual', label: 'Manuais' },
  { value: 'automatic', label: 'Entregas' },
];

export default function VisitsScreen() {
  return (
    <RequirePermission anyOf={['visits:own:manage']} title="Visitas">
      <Visits />
    </RequirePermission>
  );
}

function Visits() {
  const session = useSession();
  const me = session.user?.uid;
  const admin = session.role === 'administrator';
  const compact = useLayoutSize() === 'compact';
  const params = useLocalSearchParams<{ customerId?: string }>();
  const customerId = params.customerId || undefined;
  const customer = useCustomer(customerId ?? '', Boolean(customerId));
  const members = useMembers(admin && session.permissions.includes('users:manage'));
  const [source, setSource] = useState<SourceFilter>('all');
  const [responsible, setResponsible] = useState('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const invalidRange = Boolean(from && to && from > to);

  const filters = useMemo<VisitFilters>(
    () => ({
      ...(customerId ? { customerId } : {}),
      ...(source !== 'all' ? { source } : {}),
      ...(responsible !== 'any' ? { responsibleUid: responsible } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [customerId, source, responsible, from, to],
  );
  const { query, items } = useVisitList(filters, !invalidRange);
  const filtered = Object.keys(filters).length > 0;

  const responsibleOptions = [
    { value: 'any', label: 'Todos os responsáveis' },
    ...(members.data ?? []).map((m) => ({
      value: m.id,
      label: memberLabel(m),
      description: m.status === 'active' ? undefined : 'Desativado',
    })),
  ];
  const newHref = (customerId ? `/visitas/nova?customerId=${customerId}` : '/visitas/nova') as Href;

  const columns: Column<Visit>[] = [
    {
      key: 'date',
      label: 'Data',
      width: 104,
      render: (v) => <Text variant="small">{formatDay(v.visitDate)}</Text>,
    },
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (v) => (
        <Text variant="bodyStrong" numberOfLines={1}>
          {v.customerName}
        </Text>
      ),
    },
    {
      key: 'kind',
      label: 'Atendimento',
      flex: 3,
      render: (v) => <KindCell visit={v} />,
    },
    {
      key: 'responsible',
      label: 'Responsável',
      flex: 2,
      render: (v) => (
        <Text variant="small" numberOfLines={1}>
          {personLabel(v.responsibleUid, v.responsibleName, me)}
        </Text>
      ),
    },
    {
      key: 'order',
      label: 'Pedido',
      width: 132,
      render: (v) => <OrderCell visit={v} />,
    },
    {
      key: 'notes',
      label: 'Observações',
      flex: 3,
      render: (v) => (
        <Text variant="small" color={color.textSecondary} numberOfLines={2}>
          {v.notes || '—'}
        </Text>
      ),
    },
  ];

  return (
    <Screen
      title="Visitas"
      description={
        query.isPending
          ? admin
            ? 'Atendimentos de toda a empresa.'
            : 'Atendimentos dos clientes da sua carteira.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'registro', 'registros')
      }
      actions={
        <Link href={newHref} asChild>
          <Button label="Registrar visita" icon={Plus} variant="strong" fullWidth={compact} />
        </Link>
      }
    >
      <VisitsNav current="visits" />
      {customerId ? (
        <View style={styles.scope}>
          <Text variant="small" color={color.textSecondary}>
            Cliente:
          </Text>
          <Text variant="smallStrong" numberOfLines={1} style={styles.flex}>
            {customer.data?.name ?? 'Carregando…'}
          </Text>
          <Button
            label="Ver todos"
            icon={X}
            size="sm"
            variant="ghost"
            onPress={() => router.setParams({ customerId: '' })}
          />
        </View>
      ) : null}
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <Segmented label="Origem" options={sourceOptions} value={source} onChange={setSource} />
        {admin && members.data ? (
          <View style={[styles.field, compact && styles.fieldCompact]}>
            <Select
              label="Responsável"
              hideLabel
              value={responsible}
              options={responsibleOptions}
              onChange={setResponsible}
            />
          </View>
        ) : null}
        <View style={[styles.date, compact && styles.fieldCompact]}>
          <DateField label="De" value={from} onChange={setFrom} optional />
        </View>
        <View style={[styles.date, compact && styles.fieldCompact]}>
          <DateField
            label="Até"
            value={to}
            onChange={setTo}
            optional
            error={invalidRange ? 'Data final antes da inicial.' : undefined}
          />
        </View>
      </View>

      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum registro encontrado"
              description="Mude os filtros ou o período para ver outros atendimentos."
            />
          ) : (
            <EmptyState
              icon={CalendarCheck}
              title="Nenhuma visita registrada"
              description="Registre visitas e contatos com clientes. Entregas confirmadas nos pedidos aparecem aqui automaticamente."
              action={
                <Link href={newHref} asChild>
                  <Button label="Registrar visita" icon={Plus} variant="strong" />
                </Link>
              }
            />
          )
        }
      >
        <DataTable
          label="Visitas"
          rows={items}
          keyOf={(v) => v.id}
          hrefOf={(v) => `/clientes/${v.customerId}` as Href}
          columns={columns}
          renderCompact={(v) => (
            <View style={styles.compact}>
              <View style={styles.compactHead}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {v.customerName}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {formatDay(v.visitDate)}
                </Text>
              </View>
              <KindCell visit={v} />
              <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                {[
                  personLabel(v.responsibleUid, v.responsibleName, me),
                  v.orderCommercialId ? shortOrderId(v.orderCommercialId) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {v.notes ? (
                <Text variant="small" color={color.textSecondary} numberOfLines={2}>
                  {v.notes}
                </Text>
              ) : null}
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

function KindCell({ visit: v }: { visit: Visit }) {
  return (
    <View style={styles.kind}>
      <Badge label={sourceCopy[v.source].label} tone={sourceCopy[v.source].tone} />
      <Text variant="small" numberOfLines={1}>
        {kindLabel[v.kind]}
      </Text>
    </View>
  );
}

function OrderCell({ visit: v }: { visit: Visit }) {
  if (!v.orderId || !v.orderCommercialId)
    return (
      <Text variant="small" color={color.textSecondary}>
        —
      </Text>
    );
  const label = shortOrderId(v.orderCommercialId);
  if (!v.orderAccessible) return <Text variant="small">{label}</Text>;
  return (
    <Link href={`/pedidos/${v.orderId}` as Href} asChild>
      <Button
        label={label}
        size="sm"
        variant="ghost"
        accessibilityLabel={`Abrir pedido ${label}`}
      />
    </Link>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  field: { minWidth: 220 },
  date: { width: 170 },
  fieldCompact: { minWidth: 0, width: 'auto' },
  scope: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  kind: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  compact: { gap: 4 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1, minWidth: 0 },
});
