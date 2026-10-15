import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Product } from '@/api/types';
import { useInventoryList, useSeedInventoryItems } from '@/features/inventory/api';
import { useProductList } from '@/features/products/api';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity, unitLabel } from '@/lib/quantity';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, layout, space } from '@/theme';
import { Alert, Button, SearchField, Skeleton, Text } from '@/ui';
import { Check, Plus } from '@/ui/icons';

/**
 * Busca de produtos ativos para o carrinho. Preço e unidade vêm de `GET /products`; o disponível,
 * de `GET /inventory` com o mesmo filtro (as duas listas usam nome crescente, então os itens se
 * correspondem). Os saldos recebidos alimentam o cache por produto do estoque.
 */
export function ProductSearch({
  inCart,
  onAdd,
}: {
  inCart: ReadonlySet<string>;
  onAdd: (product: Product) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const products = useProductList({ q, status: 'active' });
  const stock = useInventoryList({ q, status: 'active', order: 'name' });
  const seed = useSeedInventoryItems();
  useEffect(() => {
    if (stock.items.length) seed(stock.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock.items.length, stock.query.dataUpdatedAt]);

  const available = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stock.items) map.set(s.productId, fromApiQuantity(s.available));
    return map;
  }, [stock.items]);

  return (
    <View style={styles.root}>
      <SearchField
        label="Buscar produtos"
        hideLabel
        placeholder="Buscar produto pelo início do nome"
        value={search}
        onChangeText={setSearch}
      />
      {products.query.isError ? (
        <Alert tone="danger" title="Não foi possível carregar os produtos">
          {toApiError(products.query.error).userMessage}
        </Alert>
      ) : products.query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando produtos">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" />
        </View>
      ) : products.items.length === 0 ? (
        <Text variant="body" color={color.textSecondary}>
          {q ? 'Nenhum produto ativo começa com esse nome.' : 'Nenhum produto ativo cadastrado.'}
        </Text>
      ) : (
        <View accessibilityRole="list" accessibilityLabel="Resultados da busca de produtos">
          {products.items.map((p) => (
            <ResultRow
              key={p.id}
              product={p}
              available={available.get(p.id)}
              added={inCart.has(p.id)}
              onAdd={onAdd}
            />
          ))}
          {products.query.hasNextPage ? (
            <Button
              label="Mais produtos"
              size="sm"
              variant="outline"
              loading={products.query.isFetchingNextPage}
              onPress={() => {
                products.query.fetchNextPage();
                if (stock.query.hasNextPage) stock.query.fetchNextPage();
              }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const ResultRow = memo(function ResultRow({
  product: p,
  available,
  added,
  onAdd,
}: {
  product: Product;
  available: number | undefined;
  added: boolean;
  onAdd: (product: Product) => void;
}) {
  const out = available !== undefined && available <= 0;
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {p.name}
        </Text>
        <Text variant="small" color={color.textSecondary} numberOfLines={1}>
          {`${p.sku} · ${formatCents(p.priceCents)} por ${unitLabel[p.unit]}`}
        </Text>
        <Text variant="caption" color={out ? color.danger : color.textSecondary}>
          {available === undefined
            ? 'Disponível: consultando'
            : out
              ? 'Sem disponível no estoque'
              : `Disponível: ${formatQuantity(available, p.unit)}`}
        </Text>
      </View>
      <Button
        label={added ? 'No carrinho' : 'Adicionar'}
        accessibilityLabel={added ? `${p.name} já está no carrinho` : `Adicionar ${p.name}`}
        icon={added ? Check : Plus}
        size="sm"
        variant={added ? 'ghost' : 'outline'}
        disabled={added}
        onPress={() => onAdd(p)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: space[3] },
  loading: { gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 12,
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  flex: { flex: 1, minWidth: 0, gap: 1 },
});
