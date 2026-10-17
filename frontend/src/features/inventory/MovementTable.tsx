import { StyleSheet, View } from 'react-native';
import type { Movement } from '@/api/types';
import { shortId } from '@/features/users/api';
import { formatDateTime } from '@/lib/dates';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, DataTable, Dialog, Text, type BadgeTone, type Column } from '@/ui';
import { useState } from 'react';
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
  const layoutSize = useLayoutSize();
  const [selected, setSelected] = useState<Movement | null>(null);
  const names = useProductNames(showProduct ? rows.map((r) => r.productId) : []);
  const who = (uid: string) => (uid === user?.uid ? 'Você' : `Usuário ${shortId(uid)}`);
  const productName = (id: string) => names.get(id) ?? `Produto ${shortId(id)}`;

  const columns: Column<Movement>[] = [
    {
      key: 'when',
      label: 'Data',
      width: 110,
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
      width: 135,
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
      width: 100,
      align: 'right',
      render: (m) => <Text variant="figure">{effectText(m)}</Text>,
    },
    {
      key: 'balance',
      label: 'Saldo após',
      width: 100,
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
    <>
    <DataTable
      label="Movimentações de estoque"
      rows={rows}
      keyOf={(m) => m.id}
      stacked={stacked || layoutSize !== 'expanded'}
      actionsWidth={72}
      actions={(m) => <Button label="Detalhes" variant="ghost" size="sm" onPress={() => setSelected(m)} />}
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
            {`${originLabel(m)} · ${who(m.actorUid)}`}
          </Text>
        </View>
      )}
    />
    <Dialog visible={selected !== null} title="Detalhes da movimentação"
      onClose={() => setSelected(null)}
      actions={<Button label="Fechar" variant="ghost" onPress={() => setSelected(null)} />}>
      {selected ? <View style={styles.detail}>
        <Text variant="bodyStrong">{showProduct ? productName(selected.productId) : movementTypeLabel[selected.type]}</Text>
        <Badge label={movementTypeLabel[selected.type]} tone={tone[selected.type]} />
        <Text variant="small">{formatDateTime(selected.occurredAt)} · {who(selected.actorUid)}</Text>
        <Text variant="bodyStrong">{effectText(selected)}</Text>
        <Text variant="small">{`Físico: ${formatQuantity(fromApiQuantity(selected.previousPhysical), selected.unit)} → ${formatQuantity(fromApiQuantity(selected.physical), selected.unit)}`}</Text>
        <Text variant="small">{`Reservado: ${formatQuantity(fromApiQuantity(selected.previousReserved), selected.unit)} → ${formatQuantity(fromApiQuantity(selected.reserved), selected.unit)}`}</Text>
        <Text variant="small">{reasonText(selected) ?? 'Movimentação automática do pedido'}</Text>
        {selected.notes ? <Text variant="small" selectable>{selected.notes}</Text> : null}
        <Text variant="caption" color={color.textSecondary}>{originLabel(selected)}</Text>
        {selected.origin === 'order' ? <Text variant="caption" selectable>{`Referência de origem: ${selected.originReference}`}</Text> : null}
        <Text variant="caption" selectable>{`Responsável: ${selected.actorUid}`}</Text>
      </View> : null}
    </Dialog>
    </>
  );
}

const styles = StyleSheet.create({
  detail: { gap: space[3] },
  type: { gap: 2, alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  compact: { gap: space[1] },
  compactTop: { gap: space[1] },
  flex: { flex: 1, minWidth: 0 },
});
