import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { shortId } from '@/features/users/api';
import { formatDateTime } from '@/lib/dates';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text } from '@/ui';
import { useOrderHistory } from './api';
import { eventLabel } from './rules';

/**
 * Histórico do pedido (`GET /orders/{id}/history`), em ordem de versão. O contrato traz só o id
 * de quem agiu: aparece "Você" ou um código neutro.
 */
/** Cada comando ou edição invalida esta consulta (ver `useStoreOrder`). */
export function OrderHistoryPanel({ orderId }: { orderId: string }) {
  const { user } = useSession();
  const { query, items } = useOrderHistory(orderId);

  return (
    <Panel title="Histórico">
      {query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando histórico">
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </View>
      ) : query.isError ? (
        <Alert tone="danger" title="Histórico indisponível">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : (
        <View style={styles.list}>
          {items.map((e) => (
            <View key={e.id} style={styles.event}>
              <View style={styles.dot} />
              <View style={styles.flex}>
                <Text variant="smallStrong">{eventLabel[e.type]}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  {`${formatDateTime(e.occurredAt)} · ${e.actorUid === user?.uid ? 'Você' : `Usuário ${shortId(e.actorUid)}`} · versão ${e.version}`}
                </Text>
                {e.reason ? (
                  <Text variant="small" selectable>
                    {`Motivo: ${e.reason}`}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          {query.hasNextPage ? (
            <Button
              label="Ver mais eventos"
              size="sm"
              variant="outline"
              loading={query.isFetchingNextPage}
              onPress={() => query.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  list: { gap: space[3], paddingTop: space[1] },
  event: { flexDirection: 'row', gap: space[3] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent, marginTop: 5 },
  flex: { flex: 1, minWidth: 0, gap: 1 },
});
