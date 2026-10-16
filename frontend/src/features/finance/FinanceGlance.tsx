import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { color, space } from '@/theme';
import { Badge, Button, Panel, Skeleton, Text } from '@/ui';
import { RowLink } from './FinanceParts';
import { executionKindLabel, executionStage, orderCode } from './presentation';
import { useExecutions } from './resolutionApi';

/** Início: operações financeiras em etapas que pedem continuidade. Sem totais inferidos. */
export function FinanceGlance() {
  const list = useExecutions({ pending: 'true' });
  return (
    <Panel
      title="Operações financeiras em andamento"
      description="Cancelamentos e devoluções que aguardam continuidade."
      action={
        <Link href={'/financeiro' as Href} asChild>
          <Button label="Financeiro" size="sm" variant="ghost" />
        </Link>
      }
    >
      {list.query.isPending ? (
        <Skeleton height={18} />
      ) : list.query.isError ? (
        <Text variant="small" color={color.textSecondary}>
          {toApiError(list.query.error).userMessage}
        </Text>
      ) : list.items.length ? (
        <View>
          {list.items.slice(0, 5).map((e) => {
            const stage = executionStage(e);
            return (
              <RowLink key={e.id} href={`/financeiro/execucoes/${e.id}` as Href}>
                <View style={styles.row}>
                  <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {`${executionKindLabel(e.kind)} · ${orderCode(e.orderId)}`}
                  </Text>
                  <Badge label={stage.label} tone={stage.tone} />
                </View>
              </RowLink>
            );
          })}
          {list.items.length > 5 || list.query.hasNextPage ? (
            <Link href={'/financeiro/execucoes' as Href} asChild>
              <Button label="Ver todas" size="sm" variant="ghost" />
            </Link>
          ) : null}
        </View>
      ) : (
        <Text variant="small" color={color.textSecondary}>
          Nenhuma operação em andamento.
        </Text>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  flex: { flex: 1, minWidth: 0 },
});
