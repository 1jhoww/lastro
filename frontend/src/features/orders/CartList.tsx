import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatCents } from '@/lib/money';
import { formatQuantity, unitLabel } from '@/lib/quantity';
import { color, space, useLayoutSize } from '@/theme';
import { IconButton, QuantityInput, Text } from '@/ui';
import { Trash } from '@/ui/icons';
import { lineSubtotalPreview, type CartLine } from './rules';

/**
 * Carrinho. Cada linha é memorizada: alterar uma quantidade só redesenha aquela linha, o que
 * mantém carrinhos de centenas de itens responsivos no celular. Quantidade sempre em milésimos.
 */
export function CartList({
  lines,
  available,
  onQuantity,
  onRemove,
  disabled,
}: {
  lines: readonly CartLine[];
  /** Disponível conhecido por produto (milésimos). Ausente = não consultado. */
  available: ReadonlyMap<string, number>;
  onQuantity: (productId: string, milli: number) => void;
  onRemove: (productId: string) => void;
  disabled?: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  return (
    <View accessibilityRole="list" accessibilityLabel="Itens do pedido">
      {lines.map((line, i) => (
        <CartRow
          key={line.productId}
          line={line}
          available={available.get(line.productId)}
          last={i === lines.length - 1}
          compact={compact}
          onQuantity={onQuantity}
          onRemove={onRemove}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

const CartRow = memo(function CartRow({
  line,
  available,
  last,
  compact,
  onQuantity,
  onRemove,
  disabled,
}: {
  line: CartLine;
  available: number | undefined;
  last: boolean;
  compact: boolean;
  onQuantity: (productId: string, milli: number) => void;
  onRemove: (productId: string) => void;
  disabled?: boolean;
}) {
  const subtotal = lineSubtotalPreview(line.unitPriceCents, line.quantityMilli);
  const short = available !== undefined && line.quantityMilli > available;
  const subtotalText = (
    <Text
      variant="figure"
      style={compact ? undefined : styles.subtotal}
      accessibilityLabel={`Subtotal ${formatCents(subtotal)}`}
    >
      {formatCents(subtotal)}
    </Text>
  );
  return (
    <View style={[styles.row, compact && styles.rowCompact, !last && styles.divider]}>
      <View style={[styles.info, compact && styles.infoCompact]}>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {line.name}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {`${line.sku} · ${formatCents(line.unitPriceCents)} por ${unitLabel[line.unit]}`}
          </Text>
          {short ? (
            <Text variant="caption" color={color.danger}>
              {`Disponível agora: ${formatQuantity(available!, line.unit)}. A confirmação pode ser recusada.`}
            </Text>
          ) : available !== undefined ? (
            <Text variant="caption" color={color.textSecondary}>
              {`Disponível: ${formatQuantity(available, line.unit)}`}
            </Text>
          ) : null}
        </View>
        {/* Celular: subtotal ao lado do nome; quantidade e remover na linha de baixo. */}
        {compact ? subtotalText : null}
      </View>
      <View style={[styles.controls, compact && styles.controlsCompact]}>
        <QuantityInput
          label={`Quantidade de ${line.name}`}
          unit={line.unit}
          value={line.quantityMilli}
          min={line.unit === 'KG' || line.unit === 'L' ? 1 : 1000}
          onChange={(milli) => !disabled && onQuantity(line.productId, milli)}
        />
        {compact ? null : subtotalText}
        <IconButton
          icon={Trash}
          label={`Remover ${line.name}`}
          disabled={disabled}
          onPress={() => onRemove(line.productId)}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], paddingVertical: space[3] },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: space[2] },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  info: { flex: 1, minWidth: 0 },
  infoCompact: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  flex: { flex: 1, minWidth: 0, gap: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  controlsCompact: { justifyContent: 'space-between' },
  subtotal: { minWidth: 104, textAlign: 'right' },
});
