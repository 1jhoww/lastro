import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Product } from '@/api/types';
import { useInventoryList, useSeedInventoryItems } from '@/features/inventory/api';
import { useProductList } from '@/features/products/api';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity, unitLabel } from '@/lib/quantity';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, QuantityInput, SearchField, Skeleton, Text } from '@/ui';

/**
 * Busca de produtos ativos para o carrinho. Preço e unidade vêm de `GET /products`; o disponível,
 * de `GET /inventory` com o mesmo filtro (as duas listas usam nome crescente, então os itens se
 * correspondem). Os saldos recebidos alimentam o cache por produto do estoque.
 * Cada linha tem o mesmo controle de quantidade do carrinho: zero = fora do pedido.
 */
export function ProductSearch({
  quantities,
  onQuantity,
}: {
  /** Quantidade no carrinho por produto (milésimos). Ausente = fora do carrinho. */
  quantities: ReadonlyMap<string, number>;
  onQuantity: (product: Product, milli: number) => void;
}) {
  const compact = useLayoutSize() === 'compact';
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
              quantity={quantities.get(p.id) ?? 0}
              compact={compact}
              onQuantity={onQuantity}
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
  quantity,
  compact,
  onQuantity,
}: {
  product: Product;
  available: number | undefined;
  quantity: number;
  compact: boolean;
  onQuantity: (product: Product, milli: number) => void;
}) {
  const out = available !== undefined && available <= 0;
  const added = quantity > 0;
  const price = (
    <Text variant="figure" style={compact ? undefined : styles.price}>
      {formatCents(p.priceCents)}
    </Text>
  );
  return (
    <View
      style={[styles.row, compact && styles.rowCompact, added && styles.added]}
      accessibilityLabel={added ? `${p.name}, no carrinho` : undefined}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {p.name}
        </Text>
        <Text variant="small" color={color.textSecondary} numberOfLines={1}>
          {`${p.sku} · ${unitLabel[p.unit]} · `}
          <Text variant="small" color={out ? color.danger : color.textSecondary}>
            {available === undefined
              ? 'consultando estoque'
              : out
                ? 'sem disponível'
                : `${formatQuantity(available, p.unit)} disponível`}
          </Text>
        </Text>
      </View>
      <View style={[styles.controls, compact && styles.controlsCompact]}>
        {price}
        <QuantityInput
          label={`Quantidade de ${p.name}`}
          unit={p.unit}
          value={quantity}
          min={0}
          size={compact ? 'md' : 'sm'}
          onChange={(milli) => onQuantity(p, milli)}
        />
      </View>
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
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: space[2] },
  // Seleção discreta: filete amarelo e fundo levemente quente.
  added: { borderLeftColor: color.accent, backgroundColor: 'rgba(243,184,0,0.07)' },
  flex: { flex: 1, minWidth: 0, gap: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  controlsCompact: { justifyContent: 'space-between' },
  price: { minWidth: 92, textAlign: 'right' },
});
