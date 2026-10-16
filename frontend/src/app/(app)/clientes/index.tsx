import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Customer, StatusFilter } from '@/api/types';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { useCustomerList } from '@/features/customers/api';
import { addressComplete, cityState } from '@/features/customers/presentation';
import { useAssigneeLabel, useMembers, memberLabel } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatDocument, formatPhone, normalizeDocument, validDocument } from '@/lib/document';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  IconButton,
  SearchField,
  Segmented,
  Select,
  Text,
  type Column,
} from '@/ui';
import { Pencil, Plus, SearchX, Users } from '@/ui/icons';

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

  // CPF/CNPJ completo e válido vira busca exata pelo documento; o resto busca pelo nome.
  const byDocument = validDocument(q) ? normalizeDocument(q) : null;
  const filters = useMemo(
    () => ({
      q: byDocument ? '' : q,
      status,
      ...(byDocument ? { document: byDocument } : {}),
      ...(admin && assignedTo !== 'any' ? { assignedTo } : {}),
    }),
    [q, byDocument, status, admin, assignedTo],
  );
  const { query, items } = useCustomerList(filters);

  const sellerOptions = [
    { value: 'any', label: 'Todos os responsáveis' },
    { value: 'unassigned', label: 'Sem responsável' },
    ...(members.data ?? [])
      .filter((m) => m.role === 'seller')
      .map((m) => ({
        value: m.id,
        label: memberLabel(m),
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
      render: (c) => (
        <Text variant="small" numberOfLines={1}>
          {formatDocument(c.document) || '—'}
        </Text>
      ),
    },
    {
      key: 'phone',
      label: 'Telefone',
      flex: 2,
      render: (c) => (
        <Text variant="small" numberOfLines={1}>
          {formatPhone(c.phone) || '—'}
        </Text>
      ),
    },
    {
      key: 'city',
      label: 'Cidade/UF',
      flex: 2,
      render: (c) => (
        <Text
          variant="small"
          numberOfLines={1}
          color={addressComplete(c.address) ? color.text : color.textSecondary}
        >
          {cityState(c.address) || 'Sem endereço'}
        </Text>
      ),
    },
    ...(admin
      ? [
          {
            key: 'owner',
            label: 'Responsável',
            flex: 2,
            render: (c: Customer) => (
              <Text variant="small" numberOfLines={1}>
                {label(c.assignedTo)}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'status',
      label: 'Situação',
      width: 88,
      render: (c) => <StatusBadge active={c.status === 'active'} />,
    },
  ];

  const searching = q.trim().length > 0 || status !== 'active' || assignedTo !== 'any';
  const editAction = (c: Customer) => (
    <Link href={`/clientes/${c.id}/editar` as Href} asChild>
      <IconButton icon={Pencil} label={`Editar ${c.name}`} />
    </Link>
  );

  return (
    <Screen
      title="Clientes"
      description={
        query.isPending
          ? admin
            ? 'Clientes da empresa.'
            : 'Clientes da sua carteira.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'cliente', 'clientes')
      }
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
            placeholder="Nome ou CPF/CNPJ completo"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Segmented label="Situação" options={statusOptions} value={status} onChange={setStatus} />
        {admin ? (
          <View style={[styles.owner, compact && styles.ownerCompact]}>
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
              description={
                byDocument
                  ? 'Nenhum cliente com este CPF/CNPJ nos filtros atuais.'
                  : 'A busca considera o início do nome ou o CPF/CNPJ completo. Confira a grafia ou mude os filtros.'
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title={admin ? 'Nenhum cliente cadastrado' : 'Sua carteira está vazia'}
              description="Cadastre com nome e endereço. CPF ou CNPJ é opcional."
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
          actions={editAction}
          renderCompact={(c) => (
            <View style={styles.compact}>
              <View style={styles.compactHead}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {c.name}
                </Text>
                {c.status === 'inactive' ? <StatusBadge active={false} /> : null}
              </View>
              <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                {[formatPhone(c.phone), cityState(c.address)].filter(Boolean).join(' · ') ||
                  c.tradeName ||
                  'Sem contato ou endereço'}
              </Text>
              {admin ? (
                <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
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

function StatusBadge({ active }: { active: boolean }) {
  return <Badge label={active ? 'Ativo' : 'Inativo'} tone={active ? 'success' : 'neutral'} />;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 260 },
  owner: { minWidth: 220 },
  ownerCompact: { minWidth: 0 },
  compact: { gap: 2 },
  compactHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
