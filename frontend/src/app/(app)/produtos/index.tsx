import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Product, StatusFilter } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { useProductList } from '@/features/products/api';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { unitLabel } from '@/lib/quantity';
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
import { Package, Plus, SearchX, Tags } from '@/ui/icons';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

type CatalogFilter = 'any' | 'true' | 'false';

export default function Products() {
  const { permissions } = useSession();
  const manage = permissions.includes('products:manage');
  const compact = useLayoutSize() === 'compact';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [categoryId, setCategoryId] = useState('any');
  const [catalog, setCatalog] = useState<CatalogFilter>('any');
  const q = useDebouncedValue(search);
  const categories = useCategoryLookup();

  const filters = useMemo(
    () => ({
      q,
      // Vendedor só recebe ativos; não enviar outro status para ele.
      status: manage ? status : ('active' as const),
      ...(categoryId !== 'any' ? { categoryId } : {}),
      ...(manage && catalog !== 'any' ? { catalogVisible: catalog } : {}),
    }),
    [q, status, categoryId, catalog, manage],
  );
  const { query, items } = useProductList(filters);
  const categoryName = (id: string | null) =>
    id ? (categories.data?.find((c) => c.id === id)?.name ?? '—') : 'Sem categoria';

  const columns: Column<Product>[] = [
    {
      key: 'name',
      label: 'Produto',
      flex: 3,
      render: (p) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {p.name}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {p.sku}
          </Text>
        </View>
      ),
    },
    {
      key: 'category',
      label: 'Categoria',
      flex: 2,
      render: (p) => (
        <Text variant="small" numberOfLines={1}>
          {categoryName(p.categoryId)}
        </Text>
      ),
    },
    {
      key: 'unit',
      label: 'Unidade',
      width: 80,
      render: (p) => <Text variant="small">{p.unit}</Text>,
    },
    {
      key: 'price',
      label: 'Preço',
      width: 120,
      align: 'right',
      render: (p) => <Text variant="figure">{formatCents(p.priceCents)}</Text>,
    },
    ...(manage
      ? [
          {
            key: 'catalog',
            label: 'Catálogo',
            width: 96,
            render: (p: Product) => (
              <Text variant="small" color={p.catalogVisible ? color.text : color.textSecondary}>
                {p.catalogVisible ? 'Visível' : 'Oculto'}
              </Text>
            ),
          },
          {
            key: 'status',
            label: 'Situação',
            width: 96,
            render: (p: Product) => (
              <Badge
                label={p.status === 'active' ? 'Ativo' : 'Inativo'}
                tone={p.status === 'active' ? 'success' : 'neutral'}
              />
            ),
          },
        ]
      : []),
  ];

  const categoryOptions = [
    { value: 'any', label: 'Todas as categorias' },
    ...(categories.data ?? []).map((c) => ({
      value: c.id,
      label: c.status === 'active' ? c.name : `${c.name} (inativa)`,
    })),
  ];
  const filtered =
    q.trim().length > 0 || status !== 'active' || categoryId !== 'any' || catalog !== 'any';

  return (
    <Screen
      title="Produtos"
      description={
        manage ? 'Catálogo, preços e categorias.' : 'Produtos ativos e seus preços de tabela.'
      }
      actions={
        manage ? (
          <>
            <Link href={'/produtos/categorias' as Href} asChild>
              <Button label="Categorias" icon={Tags} variant="outline" fullWidth={compact} />
            </Link>
            <Link href={'/produtos/novo' as Href} asChild>
              <Button label="Novo produto" icon={Plus} variant="strong" fullWidth={compact} />
            </Link>
          </>
        ) : null
      }
    >
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label="Buscar produtos"
            hideLabel
            placeholder="Buscar pelo início do nome"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <View style={styles.select}>
          <Select
            label="Categoria"
            hideLabel
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
          />
        </View>
        {manage ? (
          <Segmented label="Situação" options={statusOptions} value={status} onChange={setStatus} />
        ) : null}
        {manage ? (
          <Segmented<CatalogFilter>
            label="Catálogo"
            value={catalog}
            onChange={setCatalog}
            options={[
              { value: 'any', label: 'Catálogo: todos' },
              { value: 'true', label: 'Visíveis' },
              { value: 'false', label: 'Ocultos' },
            ]}
          />
        ) : null}
      </View>

      <ListPanel
        query={query}
        count={items.length}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum produto encontrado"
              description="A busca considera o início do nome. Confira a grafia ou mude os filtros."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="Nenhum produto cadastrado"
              description={
                manage
                  ? 'Cadastre com nome, SKU, unidade e preço. A foto pode entrar depois.'
                  : 'Quando o administrador cadastrar produtos, eles aparecem aqui.'
              }
              action={
                manage ? (
                  <Link href={'/produtos/novo' as Href} asChild>
                    <Button label="Novo produto" icon={Plus} variant="strong" />
                  </Link>
                ) : null
              }
            />
          )
        }
      >
        <DataTable
          label="Produtos"
          rows={items}
          keyOf={(p) => p.id}
          hrefOf={(p) => `/produtos/${p.id}` as Href}
          columns={columns}
          renderCompact={(p) => (
            <View style={styles.compactRow}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {`${p.sku}, ${categoryName(p.categoryId)}`}
                </Text>
              </View>
              <View style={styles.price}>
                <Text variant="figure">{formatCents(p.priceCents)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {p.status === 'inactive' ? 'inativo' : `por ${unitLabel[p.unit]}`}
                </Text>
              </View>
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
  select: { minWidth: 220 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  price: { alignItems: 'flex-end' },
});
