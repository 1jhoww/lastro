import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Customer, StatusFilter } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { useCustomerList } from '@/features/customers/api';
import { useAssigneeLabel, useMembers, shortId } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatDocument, formatPhone } from '@/lib/document';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  SearchField,
  Segmented,
  Select,
  Text,
  type Column,
} from '@/ui';
import { Plus, SearchX, Users } from '@/ui/icons';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

export default function Customers() {
  const { permissions } = useSession();
  const admin = permissions.includes('customers:all:manage');
  const compact = useLayoutSize() === 'compact';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [assignedTo, setAssignedTo] = useState<string>('any');
  const q = useDebouncedValue(search);
  const label = useAssigneeLabel();
  const members = useMembers(admin);

  const filters = useMemo(
    () => ({ q, status, ...(admin && assignedTo !== 'any' ? { assignedTo } : {}) }),
    [q, status, admin, assignedTo],
  );
  const { query, items } = useCustomerList(filters);

  const sellerOptions = [
    { value: 'any', label: 'Todos os responsáveis' },
    { value: 'unassigned', label: 'Sem responsável' },
    ...(members.data ?? [])
      .filter((m) => m.role === 'seller')
      .map((m) => ({
        value: m.id,
        label: `Vendedor ${shortId(m.id)}`,
        description: m.status === 'active' ? undefined : 'Desativado',
      })),
  ];

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      label: 'Cliente',
      flex: 3,
      render: (c) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {c.name}
          </Text>
          {c.tradeName ? (
            <Text variant="small" color={color.textSecondary} numberOfLines={1}>
              {c.tradeName}
            </Text>
          ) : null}
        </View>
      ),
    },
    {
      key: 'document',
      label: 'CPF/CNPJ',
      flex: 2,
      render: (c) => <Text variant="small">{formatDocument(c.document) || '—'}</Text>,
    },
    {
      key: 'contact',
      label: 'Contato',
      flex: 2,
      render: (c) => (
        <Text variant="small" numberOfLines={1}>
          {formatPhone(c.phone) || c.email || '—'}
        </Text>
      ),
    },
    {
      key: 'city',
      label: 'Cidade',
      flex: 2,
      render: (c) => (
        <Text variant="small" numberOfLines={1}>
          {c.address?.city
            ? `${c.address.city}${c.address.state ? `/${c.address.state}` : ''}`
            : '—'}
        </Text>
      ),
    },
    ...(admin
      ? [
          {
            key: 'owner',
            label: 'Responsável',
            flex: 2,
            render: (c: Customer) => <Text variant="small">{label(c.assignedTo)}</Text>,
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Situação',
      width: 96,
      render: (c) => (
        <Badge
          label={c.status === 'active' ? 'Ativo' : 'Inativo'}
          tone={c.status === 'active' ? 'success' : 'neutral'}
        />
      ),
    },
  ];

  const searching = q.trim().length > 0 || status !== 'active' || assignedTo !== 'any';

  return (
    <Screen
      title="Clientes"
      description={admin ? 'Todos os clientes da empresa.' : 'Os clientes da sua carteira.'}
      actions={
        <Link href="/clientes/novo" asChild>
          <Button label="Novo cliente" icon={Plus} variant="strong" fullWidth={compact} />
        </Link>
      }
    >
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label="Buscar clientes"
            hideLabel
            placeholder="Buscar pelo início do nome"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Segmented label="Situação" options={statusOptions} value={status} onChange={setStatus} />
        {admin ? (
          <View style={styles.owner}>
            <Select
              label="Responsável"
              hideLabel
              value={assignedTo}
              options={sellerOptions}
              onChange={setAssignedTo}
            />
          </View>
        ) : null}
      </View>

      <ListPanel
        query={query}
        count={items.length}
        empty={
          searching ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum cliente encontrado"
              description="A busca considera o início do nome. Confira a grafia ou mude os filtros."
            />
          ) : (
            <EmptyState
              icon={Users}
              title={admin ? 'Nenhum cliente cadastrado' : 'Sua carteira está vazia'}
              description="Cadastre com o nome e complete o resto depois. CPF ou CNPJ é opcional."
              action={
                <Link href="/clientes/novo" asChild>
                  <Button label="Novo cliente" icon={Plus} variant="strong" />
                </Link>
              }
            />
          )
        }
      >
        <DataTable
          label="Clientes"
          rows={items}
          keyOf={(c) => c.id}
          hrefOf={(c) => `/clientes/${c.id}` as Href}
          columns={columns}
          renderCompact={(c) => (
            <View style={styles.compact}>
              <View style={styles.compactHead}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {c.name}
                </Text>
                {c.status === 'inactive' ? <Badge label="Inativo" /> : null}
              </View>
              <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                {[c.tradeName, formatDocument(c.document), c.address?.city]
                  .filter(Boolean)
                  .join(', ') ||
                  formatPhone(c.phone) ||
                  'Sem dados complementares'}
              </Text>
              {admin ? (
                <Text variant="caption" color={color.textSecondary}>
                  {label(c.assignedTo)}
                </Text>
              ) : null}
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 240 },
  owner: { minWidth: 220 },
  compact: { gap: 2 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
