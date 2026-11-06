import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Bonus, BonusKind } from '@/api/types';
import { useBonusList } from '@/features/bonuses/api';
import {
  bonusStatusLabel,
  bonusStatusTone,
  kindLabel,
  shortBonusId,
  unitsOf,
} from '@/features/bonuses/presentation';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { formatQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, DataTable, EmptyState, Segmented, Text, type Column } from '@/ui';
import { Gift, Plus } from '@/ui/icons';

type KindFilter = 'all' | BonusKind;
const kindOptions: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'standalone', label: 'Avulsas' },
  { value: 'order', label: 'Vinculadas' },
];

export default function BonusesScreen() {
  return (
    <RequirePermission anyOf={['bonuses:grant']} title="Bonificações">
      <Bonuses />
    </RequirePermission>
  );
}

function Bonuses() {
  const session = useSession();
  const admin = session.role === 'administrator';
  const compact = useLayoutSize() === 'compact';
  const [kind, setKind] = useState<KindFilter>('all');
  const filters = useMemo(() => (kind === 'all' ? {} : { kind }), [kind]);
  const { query, items } = useBonusList(filters);

  const columns: Column<Bonus>[] = [
    {
      key: 'number',
      label: 'Número',
      width: 136,
      render: (b) => <Text variant="smallStrong">{shortBonusId(b.commercialId)}</Text>,
    },
    {
      key: 'date',
      label: 'Data',
      width: 104,
      render: (b) => <Text variant="small">{b.occurredAt ? formatDate(b.occurredAt) : '—'}</Text>,
    },
    {
      key: 'customer',
      label: 'Cliente',
      flex: 3,
      render: (b) => (
        <Text variant="bodyStrong" numberOfLines={1}>
          {b.customerName ?? 'Sem cliente'}
        </Text>
      ),
    },
    {
      key: 'kind',
      label: 'Tipo',
      width: 104,
      render: (b) => <Text variant="small">{kindLabel[b.kind]}</Text>,
    },
    {
      key: 'responsible',
      label: 'Responsável',
      flex: 2,
      render: (b) => (
        <Text variant="small" numberOfLines={1}>
          {b.responsibleName ?? 'Usuário sem nome'}
        </Text>
      ),
    },
    {
      key: 'units',
      label: 'Unidades',
      width: 96,
      align: 'right',
      render: (b) => <Text variant="small">{formatQuantity(unitsOf(b.lines))}</Text>,
    },
    {
      key: 'status',
      label: 'Situação',
      width: 148,
      render: (b) => <Badge label={bonusStatusLabel[b.status]} tone={bonusStatusTone[b.status]} />,
    },
  ];

  return (
    <Screen
      title="Bonificações"
      description={
        query.isPending
          ? admin
            ? 'Produtos entregues sem cobrança, em toda a empresa.'
            : 'Bonificações sob sua responsabilidade.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'bonificação', 'bonificações')
      }
      actions={
        <Link href={'/bonificacoes/nova' as Href} asChild>
          <Button label="Nova bonificação" icon={Plus} variant="strong" fullWidth={compact} />
        </Link>
      }
    >
      <View style={styles.toolbar}>
        <Segmented label="Tipo" options={kindOptions} value={kind} onChange={setKind} />
      </View>
      <ListPanel
        query={query}
        count={items.length}
        empty={
          <EmptyState
            icon={Gift}
            title={kind === 'all' ? 'Nenhuma bonificação ainda' : 'Nada neste tipo'}
            description="Lançamento avulso fica aqui. Bonificação de pedido é adicionada na etapa final do Novo pedido."
          />
        }
      >
        <DataTable
          label="Bonificações"
          rows={items}
          keyOf={(b) => b.id}
          columns={columns}
          hrefOf={(b) => `/bonificacoes/${b.id}` as Href}
          renderCompact={(b) => (
            <View style={styles.compact}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {b.customerName ?? 'Sem cliente'}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {`${shortBonusId(b.commercialId)} · ${kindLabel[b.kind]}`}
                </Text>
              </View>
              <Badge label={bonusStatusLabel[b.status]} tone={bonusStatusTone[b.status]} />
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  compact: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
