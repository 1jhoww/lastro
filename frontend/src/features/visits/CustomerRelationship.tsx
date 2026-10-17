import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { TimelineEntry } from '@/api/types';
import { Fact } from '@/features/catalog/DetailParts';
import { shortOrderId, statusLabel } from '@/features/orders/rules';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, Panel, Skeleton, Text } from '@/ui';
import { Plus } from '@/ui/icons';
import { useCustomerRepurchase, useCustomerTimeline } from './api';
import {
  estimateDistance,
  formatDay,
  frequencyLabel,
  kindLabel,
  personLabel,
  repurchaseCopy,
} from './presentation';

/** Última compra, última entrega e estimativa de recompra: três datas distintas. */
export function CustomerPurchasePanel({ customerId }: { customerId: string }) {
  const data = useCustomerRepurchase(customerId);
  return (
    <Panel title="Compras e recompra">
      {data.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando estimativa">
          <Skeleton width="60%" />
          <Skeleton width="40%" />
        </View>
      ) : data.isError ? (
        <Alert tone="danger" title="Estimativa indisponível">
          {toApiError(data.error).userMessage}
        </Alert>
      ) : (
        <View style={styles.facts}>
          <Fact
            label="Última compra (pedido confirmado)"
            value={formatDay(data.data.lastPurchaseOn, 'Sem compras')}
          />
          <Fact
            label="Última entrega confirmada"
            value={formatDay(data.data.lastDeliveryOn, 'Nenhuma')}
          />
          <Fact label="Frequência estimada" value={frequencyLabel(data.data.frequencyDays)} />
          <Fact
            label="Estimativa de recompra"
            value={
              data.data.nextEstimatedOn
                ? `${formatDay(data.data.nextEstimatedOn)} · ${estimateDistance(data.data.daysFromEstimate)}`
                : 'Ainda não há dados suficientes para estimar'
            }
          />
          <View style={styles.badge}>
            <Badge
              label={repurchaseCopy[data.data.status].label}
              tone={repurchaseCopy[data.data.status].tone}
            />
          </View>
          <Text variant="caption" color={color.textSecondary}>
            {`Mediana dos intervalos entre compras confirmadas nos últimos 12 meses (mínimo de ${data.data.minimumPurchases}). Não é garantia de novo pedido.`}
          </Text>
        </View>
      )}
    </Panel>
  );
}

const STEP = 30;

/** Histórico de relacionamento: visitas manuais, entregas confirmadas e compras confirmadas. */
export function CustomerTimelinePanel({ customerId }: { customerId: string }) {
  const [limit, setLimit] = useState(STEP);
  const timeline = useCustomerTimeline(customerId, limit);
  const items = timeline.data?.items ?? [];
  return (
    <Panel
      title="Histórico de relacionamento"
      description="Visitas, entregas e compras deste cliente, mais recentes primeiro."
      action={
        <Link href={`/visitas/nova?customerId=${customerId}` as Href} asChild>
          <Button label="Registrar visita" icon={Plus} size="sm" variant="outline" />
        </Link>
      }
    >
      {timeline.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando histórico">
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </View>
      ) : timeline.isError ? (
        <Alert tone="danger" title="Histórico indisponível">
          {toApiError(timeline.error).userMessage}
        </Alert>
      ) : items.length === 0 ? (
        <Text variant="small" color={color.textSecondary}>
          Nenhuma visita, entrega ou compra registrada ainda.
        </Text>
      ) : (
        <View style={styles.list}>
          {items.map((e) => (
            <TimelineItem key={e.id} entry={e} />
          ))}
          {timeline.data?.hasMore ? (
            limit < 100 ? (
              <Button
                label="Ver mais"
                size="sm"
                variant="outline"
                loading={timeline.isFetching}
                onPress={() => setLimit((l) => Math.min(100, l + STEP))}
              />
            ) : (
              <Link href={`/visitas?customerId=${customerId}` as Href} asChild>
                <Button label="Ver todas as visitas" size="sm" variant="outline" />
              </Link>
            )
          ) : null}
        </View>
      )}
    </Panel>
  );
}

const typeCopy: Record<
  TimelineEntry['type'],
  { label: string; tone: 'accent' | 'neutral' | 'success' }
> = {
  visit: { label: 'Visita manual', tone: 'accent' },
  delivery: { label: 'Entrega confirmada', tone: 'neutral' },
  purchase: { label: 'Compra confirmada', tone: 'success' },
};

function TimelineItem({ entry: e }: { entry: TimelineEntry }) {
  const { user } = useSession();
  const order = e.order;
  const orderLabel = order ? shortOrderId(order.commercialId) : null;
  const who = e.responsibleUid ? personLabel(e.responsibleUid, e.responsibleName, user?.uid) : null;
  return (
    <View style={styles.item}>
      <View style={[styles.dot, e.type === 'visit' && styles.dotVisit]} />
      <View style={styles.flex}>
        <View style={styles.head}>
          <Text variant="smallStrong">{formatDay(e.date)}</Text>
          <Badge label={typeCopy[e.type].label} tone={typeCopy[e.type].tone} />
        </View>
        <Text variant="caption" color={color.textSecondary}>
          {[
            e.type === 'visit' && e.kind ? kindLabel[e.kind] : null,
            who ? (e.type === 'purchase' ? `Vendedor: ${who}` : `Responsável: ${who}`) : null,
            order?.status && e.type !== 'purchase'
              ? `Pedido ${statusLabel[order.status].toLowerCase()}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {e.notes ? (
          <Text variant="small" selectable>
            {e.notes}
          </Text>
        ) : null}
        {order && orderLabel ? (
          order.accessible ? (
            <View style={styles.link}>
              <Link href={`/pedidos/${order.id}` as Href} asChild>
                <Button
                  label={`Pedido ${orderLabel}`}
                  size="sm"
                  variant="ghost"
                  accessibilityLabel={`Abrir pedido ${orderLabel}`}
                />
              </Link>
            </View>
          ) : (
            <Text variant="caption" color={color.textSecondary}>
              {`Pedido ${orderLabel}`}
            </Text>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  facts: { gap: space[4], paddingTop: space[1] },
  badge: { flexDirection: 'row' },
  list: { gap: space[4], paddingTop: space[1] },
  item: { flexDirection: 'row', gap: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.textSecondary, marginTop: 6 },
  dotVisit: { backgroundColor: color.accent },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  link: { flexDirection: 'row', marginLeft: -space[3] },
});
