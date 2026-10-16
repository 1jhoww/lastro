import type { Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Screen } from '@/layout/Screen';
import { color, space, useLayoutSize } from '@/theme';
import { ListRow, Panel, Text } from '@/ui';
import { HandCoins, ListClock, RefreshCw, ShieldCheck, Undo2, Wallet } from '@/ui/icons';
import { Guidance } from './FinanceParts';
import { FinanceNav } from './FinanceNav';

/**
 * "Histórico e operações": tudo o que não é rotina diária. Nada some do sistema; operações
 * excepcionais ficam acessíveis aqui e no contexto do pedido, com explicação curta.
 */
export function OperationsScreen() {
  const wide = useLayoutSize() !== 'compact';
  return (
    <Screen
      title="Histórico e operações"
      description="Créditos, reembolsos e operações que não fazem parte do dia a dia."
    >
      <FinanceNav />
      <View style={[styles.grid, wide && styles.gridWide]}>
        <View style={styles.col}>
          <Panel title="Complementares" description="Consultas e registros ocasionais." flush>
            <ListRow
              icon={Wallet}
              title="Créditos de clientes"
              description="Valores que o cliente pode usar em compras futuras, gerados por cancelamento ou devolução."
              href={'/financeiro/creditos' as Href}
            />
            <ListRow
              icon={HandCoins}
              title="Reembolsos"
              description="Valores que a empresa precisa devolver ao cliente e o registro de quando foram devolvidos."
              href={'/financeiro/reembolsos' as Href}
            />
            <ListRow
              icon={Undo2}
              title="Devoluções de mercadoria"
              description="Acerto financeiro de devoluções já recebidas fisicamente."
              href={'/financeiro/devolucoes' as Href}
              last
            />
          </Panel>
        </View>
        <View style={styles.col}>
          <Panel
            title="Avançado"
            description="Para conferências e situações excepcionais. Use com orientação."
            flush
          >
            <ListRow
              icon={RefreshCw}
              title="Operações em andamento"
              description="Cancelamentos e devoluções grandes processados em etapas, com continuidade manual."
              href={'/financeiro/execucoes' as Href}
            />
            <ListRow
              icon={ShieldCheck}
              title="Verificar integridade dos registros"
              description="Conferência dos registros de cada pedido, em Financeiro do pedido › Verificação técnica."
              href={'/financeiro/receber' as Href}
            />
            <ListRow
              icon={ListClock}
              title="Resoluções excepcionais"
              description="Cancelamento financeiro de pedido confirmado. Disponível no Financeiro de cada pedido."
              href={'/pedidos' as Href}
              last
            />
          </Panel>
        </View>
      </View>
      <View style={styles.notes}>
        <Text variant="h3">Como funcionam</Text>
        <Guidance>
          Estorno desfaz um pagamento registrado por engano, sem apagar o histórico. Use somente
          quando o dinheiro não entrou de fato.
        </Guidance>
        <Guidance>
          Crédito do cliente só existe quando há origem comprovada (cancelamento ou devolução) e só
          é usado por ação explícita, nunca automaticamente.
        </Guidance>
        <Guidance>
          Operações em etapas só aparecem como “Concluída” quando terminam de verdade. Até lá, os
          saldos anteriores continuam valendo.
        </Guidance>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space[5] },
  gridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 0, gap: space[5] },
  notes: { gap: space[3], borderTopWidth: 1, borderTopColor: color.border, paddingTop: space[5] },
});
