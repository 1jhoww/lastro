import { StyleSheet, View } from 'react-native';
import { color, space } from '@/theme';
import { Alert, Button, Skeleton, Text } from '@/ui';
import { useInventorySummary } from './api';

/** Counts refer to active products across the company, independently of list filters. */
export function InventoryOverview() {
  const summary = useInventorySummary(true);
  if (summary.isError) return (
    <Alert tone="warning" title="Indicadores indisponíveis"
      action={<Button label="Tentar novamente" size="sm" variant="ghost" onPress={() => summary.refetch()} />}>
      A lista continua disponível. Tente atualizar os indicadores.
    </Alert>
  );
  const values = [
    { label: 'Produtos ativos', value: summary.data?.total, tint: color.text },
    { label: 'Estoque baixo', value: summary.data?.low, tint: color.warning },
    { label: 'Sem disponível', value: summary.data?.empty, tint: color.danger },
    { label: 'Com reservas', value: summary.data?.reservedProducts, tint: color.text },
  ];
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {values.map(({ label, value, tint }) => (
          <View key={label} style={styles.item}>
            <Text variant="caption" color={color.textSecondary}>{label}</Text>
            {value === undefined ? <Skeleton width={48} height={22} /> :
              <Text variant="h2" color={tint}>{value.toLocaleString('pt-BR')}</Text>}
          </View>
        ))}
      </View>
      <Text variant="caption" color={color.textSecondary}>
        Produtos ativos da empresa. Estoque baixo: disponível maior que zero e abaixo do mínimo.
        {' '}Sem disponível inclui produtos totalmente reservados. Reservas contadas por produto.
      </Text>
      <Button label="Atualizar indicadores" size="sm" variant="ghost"
        loading={summary.isFetching} onPress={() => summary.refetch()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border, borderRadius: 12, padding: space[3], gap: space[3] },
  item: { flex: 1, minWidth: 120, gap: space[1] },
});
