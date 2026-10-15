import { StyleSheet, View } from 'react-native';
import type { Movement } from '@/api/types';
import { shortId } from '@/features/users/api';
import { formatDateTime } from '@/lib/dates';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Badge, DataTable, Text, type BadgeTone, type Column } from '@/ui';
import { useProductNames } from './api';
import { movementEffect, movementTypeLabel, originLabel, reasonText } from './stock';

const tone: Record<Movement['type'], BadgeTone> = {
  STOCK_ENTRY: 'success',
  STOCK_ADJUSTMENT_IN: 'accent',
  STOCK_ADJUSTMENT_OUT: 'warning',
  STOCK_RESERVATION: 'neutral',
  STOCK_RESERVATION_RELEASE: 'neutral',
  STOCK_DISPATCH: 'strong',
  STOCK_RETURN: 'success',
};

const signed = (milli: number, unit: Movement['unit']) =>
  `${milli > 0 ? '+' : milli < 0 ? '−' : ''}${formatQuantity(Math.abs(milli), unit)}`;

/** Efeito principal: no físico; quando só o reservado muda (reserva/liberação), no reservado. */
export function effectText(m: Movement) {
  const e = movementEffect(m);
  if (e.physical !== 0) return signed(e.physical, m.unit);
  return `${signed(e.reserved, m.unit)} reservado`;
}

/**
 * Histórico de movimentações. O contrato traz só o id de quem registrou (sem nome): aparece
 * "Você" ou um código neutro ("Usuário A1B2C3"), nunca um nome inventado.
 */
export function MovementTable({
  rows,
  showProduct,
  stacked,
}: {
  rows: Movement[];
  showProduct: boolean;
  /** Lista empilhada mesmo no desktop (painel estreito). */
  stacked?: boolean;
}) {
  const { user } = useSession();
  const names = useProductNames(showProduct ? rows.map((r) => r.productId) : []);
  const who = (uid: string) => (uid === user?.uid ? 'Você' : `Usuário ${shortId(uid)}`);
  const productName = (id: string) => names.get(id) ?? `Produto ${shortId(id)}`;

  const columns: Column<Movement>[] = [
    {
      key: 'when',
      label: 'Data',
      width: 130,
      render: (m) => <Text variant="small">{formatDateTime(m.occurredAt)}</Text>,
    },
    ...(showProduct
      ? [
          {
            key: 'product',
            label: 'Produto',
            flex: 2,
            render: (m: Movement) => (
              <Text variant="bodyStrong" numberOfLines={1}>
                {productName(m.productId)}
              </Text>
            ),
          },
        ]
      : []),
    {
      key: 'type',
      label: 'Tipo',
      width: 150,
      render: (m) => (
        <View style={styles.type}>
          <Badge label={movementTypeLabel[m.type]} tone={tone[m.type]} />
          <Text variant="caption" color={color.textSecondary}>
            {originLabel(m)}
          </Text>
        </View>
      ),
    },
    {
      key: 'quantity',
      label: 'Quantidade',
      width: 120,
      align: 'right',
      render: (m) => <Text variant="figure">{effectText(m)}</Text>,
    },
    {
      key: 'balance',
      label: 'Saldo após',
      width: 120,
      align: 'right',
      render: (m) => (
        <View style={styles.right}>
          <Text variant="small">{formatQuantity(fromApiQuantity(m.physical), m.unit)}</Text>
          <Text variant="caption" color={color.textSecondary}>
            {`${formatQuantity(fromApiQuantity(m.reserved), m.unit)} reservado`}
          </Text>
        </View>
      ),
    },
    {
      key: 'reason',
      label: 'Motivo e responsável',
      flex: 2,
      render: (m) => (
        <View>
          <Text variant="small" numberOfLines={2}>
            {reasonText(m) ?? 'Movimentação automática do pedido'}
          </Text>
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {who(m.actorUid)}
          </Text>
        </View>
      ),
    },
  ];

  return (
    <DataTable
      label="Movimentações de estoque"
      rows={rows}
      keyOf={(m) => m.id}
      stacked={stacked}
      columns={columns}
      renderCompact={(m) => (
        <View style={styles.compact}>
          <View style={styles.compactTop}>
            <View style={styles.flex}>
              {showProduct ? (
                <Text variant="bodyStrong" numberOfLines={1}>
                  {productName(m.productId)}
                </Text>
              ) : null}
              <Text variant="small" color={color.textSecondary}>
                {`${movementTypeLabel[m.type]} · ${formatDateTime(m.occurredAt)}`}
              </Text>
            </View>
            <Text variant="figure">{effectText(m)}</Text>
          </View>
          <Text variant="small" numberOfLines={2}>
            {reasonText(m) ?? 'Movimentação automática do pedido'}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {`${who(m.actorUid)} · físico após: ${formatQuantity(fromApiQuantity(m.physical), m.unit)}`}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  type: { gap: 2, alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  compact: { gap: space[1] },
  compactTop: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
