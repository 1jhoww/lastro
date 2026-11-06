import { StyleSheet, View } from 'react-native';
import { formatCents } from '@/lib/money';
import { color, radius, space } from '@/theme';
import { Text } from '@/ui';
import { Stack, SummaryRow } from './Parts';
import { estimatedMargin, formatMargin } from './presentation';

const money = (cents: number | null) => (cents === null ? '—' : formatCents(cents));

/**
 * Prévia da margem no cadastro, refeita a cada digitação. O custo de referência e o custo médio
 * real ficam separados: só o primeiro é editável aqui, e cada margem diz de qual custo vem.
 */
export function MarginEstimate({
  priceCents,
  referenceCostCents,
  averageCostCents,
}: {
  priceCents: number;
  referenceCostCents: number | null;
  averageCostCents: number | null;
}) {
  const estimate = estimatedMargin(priceCents, referenceCostCents);
  const real = estimatedMargin(priceCents, averageCostCents);
  const loss = estimate.unitGrossProfitCents !== null && estimate.unitGrossProfitCents < 0;
  return (
    <View style={styles.box} accessibilityLabel="Margem estimada">
      <Stack>
        <SummaryRow label="Preço de venda" value={formatCents(priceCents)} />
        <SummaryRow label="Custo de referência" value={money(referenceCostCents)} />
        <SummaryRow label="Lucro bruto estimado" value={money(estimate.unitGrossProfitCents)} />
        <SummaryRow
          label="Margem bruta estimada"
          value={formatMargin(estimate.grossMarginBp)}
          strong
        />
        {loss ? (
          <Text variant="small" color={color.danger}>
            O preço está abaixo do custo de referência.
          </Text>
        ) : null}
        {averageCostCents !== null ? (
          <View style={styles.real}>
            <SummaryRow
              label="Custo médio do estoque"
              hint="Real: vem das compras recebidas e não muda aqui."
              value={formatCents(averageCostCents)}
            />
            <SummaryRow
              label="Margem sobre o custo médio"
              value={formatMargin(real.grossMarginBp)}
            />
          </View>
        ) : null}
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  real: {
    gap: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
});
