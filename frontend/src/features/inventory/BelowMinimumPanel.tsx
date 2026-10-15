import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { color, space } from '@/theme';
import { Alert, Button, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { PackageOpen } from '@/ui/icons';
import { useReplenishment } from './api';
import { qty } from './StockParts';

/** Início do administrador: os produtos com maior falta para o mínimo (`/inventory/replenishment`). */
export function BelowMinimumPanel() {
  const { query, items } = useReplenishment({ q: '', status: 'active', sort: 'shortfall' }, 5);
  return (
    <Panel
      title="Abaixo do mínimo"
      description="Produtos com disponível menor que o estoque mínimo."
      action={
        items.length > 0 ? (
          <Link href={'/estoque/reposicao' as Href} asChild>
            <Button label="Ver reposição" size="sm" variant="outline" />
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
        <Alert tone="danger" title="Não foi possível carregar a reposição">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState size="compact" icon={PackageOpen} title="Nenhum produto abaixo do mínimo" />
      ) : (
        <View style={styles.list}>
          {items.map((s) => (
            <View key={s.productId} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {s.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {`Disponível ${qty(s.available, s.unit)} de ${qty(s.minimumStock, s.unit)}`}
                </Text>
              </View>
              <Text variant="smallStrong">{`Faltam ${qty(s.suggestedQuantity, s.unit)}`}</Text>
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  list: { gap: space[3], paddingTop: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
