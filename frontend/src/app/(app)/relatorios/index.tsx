import { Screen } from '@/layout/Screen';
import { Alert, ListRow, Panel } from '@/ui';
import { ClipboardList, CircleDollarSign, Store, Users } from '@/ui/icons';
import { ReportAccess } from '@/features/reports/ReportAccess';
export default function Reports() {
  return (
    <ReportAccess>
      <Screen
        title="Relatórios e exportações"
        description="Dados autorizados da empresa, consultados no servidor."
      >
        <Panel flush>
          <ListRow
            icon={ClipboardList}
            title="Pedidos e documentos"
            description="Situação, cliente e histórico de cada pedido. Valores vendidos não são recebimentos."
            href="/relatorios/pedidos"
          />
          <ListRow
            icon={CircleDollarSign}
            title="Financeiro"
            description="Títulos, vencimentos, saldos, créditos, estornos, reembolsos e reconciliação por pedido."
            href="/financeiro"
          />
          <ListRow
            icon={Users}
            title="Exportar CSV"
            description="Clientes, produtos, pedidos e recebíveis. Um arquivo por página."
            href="/relatorios/exportacoes"
          />
          <ListRow
            icon={Store}
            title="Catálogo público"
            description="Configuração, publicação e orçamento revisado para WhatsApp."
            href="/configuracoes/catalogo"
            last
          />
        </Panel>
        <Alert title="Escopo dos relatórios">
          A API não oferece indicadores globais, vendas por período, vendedor ou produto, nem
          recebimentos por período. Consulte históricos por pedido. CSV de estoque e relatório
          agregado exigem novos contratos.
        </Alert>
      </Screen>
    </ReportAccess>
  );
}
