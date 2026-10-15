import type { ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { OrderStatus } from '@/api/types';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { color, layout, space } from '@/theme';
import { Alert, Badge, Button, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import type { LucideIcon } from '@/ui/icons';
import { useOrderList } from './api';
import { shortOrderId, statusLabel, statusTone } from './rules';

/**
 * Painel do Início com até 5 pedidos (`GET /orders`). Vendedor vê só os próprios; o servidor
 * filtra. `oldestFirst` serve para "aguardando expedição": o mais antigo vem primeiro.
 */
export function OrderGlance({
  title,
  description,
  status,
  oldestFirst,
  emptyIcon,
  emptyTitle,
  action,
}: {
  title: string;
  description: string;
  status?: OrderStatus;
  oldestFirst?: boolean;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  action?: ReactNode;
}) {
  const { query, items } = useOrderList(
    { direction: oldestFirst ? 'asc' : 'desc', ...(status ? { status } : {}) },
    5,
  );
  return (
    <Panel
      title={title}
      description={description}
      action={
        items.length ? (
          <Link href={(status ? `/pedidos?situacao=${status}` : '/pedidos') as Href} asChild>
            <Button label="Ver todos" size="sm" variant="outline" />
          </Link>
        ) : null
      }
    >
      {query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" />
        </View>
      ) : query.isError ? (
        <Alert tone="danger" title="Não foi possível carregar os pedidos">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState size="compact" icon={emptyIcon} title={emptyTitle} action={action} />
      ) : (
        <View>
          {items.map((o) => (
            <Link key={o.id} href={`/pedidos/${o.id}` as Href} asChild>
              <Touchable
                accessibilityRole="link"
                pressStyle={(s: InteractionState) => [
                  styles.row,
                  (s.hovered || s.pressed) && styles.hover,
                  showFocusRing(s) && focusRing(),
                ]}
              >
                <View style={styles.flex}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {o.customerName ?? 'Sem cliente'}
                  </Text>
                  <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                    {`${shortOrderId(o.commercialId)} · ${formatDateTime(o.createdAt)}`}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text variant="figure">{formatCents(o.totalCents)}</Text>
                  {status ? null : (
                    <Badge label={statusLabel[o.status]} tone={statusTone[o.status]} />
                  )}
                </View>
              </Touchable>
            </Link>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
  flex: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: 2 },
});
