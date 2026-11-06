import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { OrderBonus } from '@/api/types';
import { formatQuantity, fromApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Badge, Button, Panel, Text } from '@/ui';
import { bonusStatusLabel, bonusStatusTone, reasonText, shortBonusId } from './presentation';

/** Itens bonificados na ficha do pedido, separados dos vendidos e fora do total. */
export function OrderBonusPanel({ bonus }: { bonus: OrderBonus }) {
  const { permissions } = useSession();
  return (
    <Panel
      title={`Bonificação (${bonus.lines.length})`}
      description={`${shortBonusId(bonus.commercialId)} · Sem cobrança, fora do total do pedido.`}
    >
      <View style={styles.body}>
        <Badge label={bonusStatusLabel[bonus.status]} tone={bonusStatusTone[bonus.status]} />
        <View accessibilityRole="list" accessibilityLabel="Itens bonificados" style={styles.lines}>
          {bonus.lines.map((l) => (
            <View key={l.id} style={styles.line}>
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {l.name}
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {l.sku}
                </Text>
              </View>
              <View style={styles.value}>
                <Text variant="small">{formatQuantity(fromApiQuantity(l.quantity), l.unit)}</Text>
                <Text variant="caption" color={color.textSecondary}>
                  Sem cobrança
                </Text>
              </View>
            </View>
          ))}
        </View>
        {bonus.reason ? (
          <Text variant="small" color={color.textSecondary}>
            {`Motivo: ${reasonText(bonus)}`}
          </Text>
        ) : null}
        {permissions.includes('bonuses:grant') ? (
          <Link href={`/bonificacoes/${bonus.id}` as Href} asChild>
            <Button label="Abrir bonificação" size="sm" variant="ghost" />
          </Link>
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3], alignItems: 'stretch' },
  lines: { gap: space[3] },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  value: { alignItems: 'flex-end', gap: 2 },
  flex: { flex: 1, minWidth: 0 },
});
