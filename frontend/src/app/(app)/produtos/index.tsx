import { useMemo, useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Product, StatusFilter } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { ListPanel, countLabel } from '@/features/catalog/ListStates';
import { ProductThumb } from '@/features/products/ProductImagePanel';
import { useProductList, useProductSkuMatch } from '@/features/products/api';
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
  IconButton,
  SearchField,
  Segmented,
  Select,
  Text,
  type Column,
} from '@/ui';
import { Package, Pencil, Plus, SearchX, Tags } from '@/ui/icons';

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
];

type CatalogFilter = 'any' | 'true' | 'false';
const catalogOptions: { value: CatalogFilter; label: string }[] = [
  { value: 'any', label: 'Catálogo: todos' },
  { value: 'true', label: 'Visíveis no catálogo' },
  { value: 'false', label: 'Ocultos do catálogo' },
];

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
  const { query, items: byName } = useProductList(filters);
  const bySku = useProductSkuMatch(filters);
  // SKU exato primeiro; depois os que começam pelo nome, sem repetir.
  const items = useMemo(() => {
    const exact = bySku.data ?? [];
    return exact.length
      ? [...exact, ...byName.filter((p) => !exact.some((e) => e.id === p.id))]
      : byName;
  }, [bySku.data, byName]);

  const categoryName = (id: string | null) =>
    id ? (categories.data?.find((c) => c.id === id)?.name ?? '—') : 'Sem categoria';

  const columns: Column<Product>[] = [
    {
      key: 'name',
      label: 'Produto',
      flex: 4,
      render: (p) => (
        <View style={styles.product}>
          <ProductThumb product={p} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {p.name}
            </Text>
            <Text variant="small" color={color.textSecondary} numberOfLines={1}>
              {p.sku}
            </Text>
          </View>
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
      width: 72,
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
            width: 88,
            render: (p: Product) => (
              <Text variant="small" color={p.catalogVisible ? color.text : color.textSecondary}>
                {p.catalogVisible ? 'Visível' : 'Oculto'}
              </Text>
            ),
          },
          {
            key: 'status',
            label: 'Situação',
            width: 88,
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
        query.isPending
          ? manage
            ? 'Catálogo, preços e categorias.'
            : 'Produtos ativos e seus preços de tabela.'
          : countLabel(items.length, Boolean(query.hasNextPage), 'produto', 'produtos')
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
            placeholder="Nome ou SKU"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        </View>
        <View style={[styles.select, compact && styles.selectCompact]}>
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
          <View style={[styles.select, compact && styles.selectCompact]}>
            <Select<CatalogFilter>
              label="Catálogo"
              hideLabel
              value={catalog}
              options={catalogOptions}
              onChange={setCatalog}
            />
          </View>
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
              description="A busca considera o início do nome ou o SKU exato. Confira a grafia ou mude os filtros."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="Nenhum produto cadastrado"
              description={
                manage
                  ? 'Cadastre com nome, SKU, unidade e preço. A imagem é opcional.'
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
          actions={
            manage
              ? (p) => (
                  <Link href={`/produtos/${p.id}/editar` as Href} asChild>
                    <IconButton icon={Pencil} label={`Editar ${p.name}`} />
                  </Link>
                )
              : undefined
          }
          renderCompact={(p) => (
            <View style={styles.product}>
              <ProductThumb product={p} size={44} />
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {[p.sku, categoryName(p.categoryId)].join(' · ')}
                </Text>
                {manage && (p.status === 'inactive' || !p.catalogVisible) ? (
                  <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                    {[
                      p.status === 'inactive' ? 'Inativo' : null,
                      p.catalogVisible ? null : 'Oculto do catálogo',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.price}>
                <Text variant="figure">{formatCents(p.priceCents)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {`por ${unitLabel[p.unit]}`}
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
  select: { minWidth: 200 },
  selectCompact: { minWidth: 0 },
  product: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
  price: { alignItems: 'flex-end' },
});
