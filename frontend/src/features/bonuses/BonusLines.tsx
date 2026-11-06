import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Product } from '@/api/types';
import { useAvailability } from '@/features/inventory/api';
import { ProductSearch } from '@/features/orders/ProductSearch';
import { formatQuantity, unitLabel } from '@/lib/quantity';
import { color, space, useLayoutSize } from '@/theme';
import { IconButton, QuantityInput, Text } from '@/ui';
import { Trash } from '@/ui/icons';
import type { BonusLineDraft } from './presentation';

/**
 * Escolha de produtos bonificados. Mesma busca do pedido, sem preço na lista: a linha mostra
 * "Sem cobrança" e nunca entra no total. `reserved` é o que o pedido já usa do mesmo produto.
 */
export function BonusLines({
  lines,
  onChange,
  reserved,
  disabled,
}: {
  lines: readonly BonusLineDraft[];
  onChange: (lines: BonusLineDraft[]) => void;
  reserved?: ReadonlyMap<string, number>;
  disabled?: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  const quantities = useMemo(
    () => new Map(lines.map((l) => [l.productId, l.quantityMilli])),
    [lines],
  );
  const available = useAvailability(useMemo(() => lines.map((l) => l.productId), [lines]));
  const set = useCallback(
    (product: Product, milli: number) => {
      if (milli <= 0) onChange(lines.filter((l) => l.productId !== product.id));
      else if (lines.some((l) => l.productId === product.id))
        onChange(
          lines.map((l) => (l.productId === product.id ? { ...l, quantityMilli: milli } : l)),
        );
      else
        onChange([
          ...lines,
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            unit: product.unit,
            quantityMilli: milli,
          },
        ]);
    },
    [lines, onChange],
  );
  return (
    <View style={styles.root}>
      <ProductSearch quantities={quantities} onQuantity={set} />
      {lines.length ? (
        <View
          style={styles.list}
          accessibilityRole="list"
          accessibilityLabel="Produtos bonificados"
        >
          {lines.map((line) => {
            const free = available.get(line.productId);
            const short =
              free !== undefined &&
              line.quantityMilli + (reserved?.get(line.productId) ?? 0) > free;
            return (
              <View key={line.productId} style={styles.row}>
                <View style={styles.flex}>
                  <Text variant="smallStrong" numberOfLines={2}>
                    {line.name}
                  </Text>
                  <Text variant="caption" color={short ? color.danger : color.textSecondary}>
                    {short
                      ? `Disponível: ${formatQuantity(free, line.unit)}`
                      : `${line.sku} · ${unitLabel[line.unit]} · Sem cobrança`}
                  </Text>
                </View>
                <QuantityInput
                  label={`Quantidade bonificada de ${line.name}`}
                  value={line.quantityMilli}
                  unit={line.unit}
                  size={compact ? 'md' : 'sm'}
                  onChange={(milli) =>
                    onChange(
                      lines.map((l) =>
                        l.productId === line.productId ? { ...l, quantityMilli: milli } : l,
                      ),
                    )
                  }
                />
                <IconButton
                  icon={Trash}
                  label={`Retirar ${line.name} da bonificação`}
                  disabled={disabled}
                  onPress={() => onChange(lines.filter((l) => l.productId !== line.productId))}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  list: { gap: space[2] },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  flex: { flex: 1, minWidth: 140 },
});
