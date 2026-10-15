import { useState } from 'react';
import { View } from 'react-native';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { ReportAccess } from '@/features/reports/ReportAccess';
import {
  buildExportRequest,
  exportDefaults,
  nextExportPage,
  type ExportFields,
} from '@/features/reports/exportRules';
import { exportPage, type ExportRequest, type ExportResource } from '@/features/files/api';
import { FileActions } from '@/features/files/FileActions';
import { Screen } from '@/layout/Screen';
import { Alert, Button, Panel, Select, Text, TextField } from '@/ui';
import { space } from '@/theme';
export default function Exports() {
  return (
    <ReportAccess>
      <ExportForm />
    </ReportAccess>
  );
}
const statuses: Record<ExportResource, { value: string; label: string }[]> = {
  customers: [
    { value: 'active', label: 'Ativos' },
    { value: 'inactive', label: 'Inativos' },
    { value: 'all', label: 'Todos' },
  ],
  products: [
    { value: 'active', label: 'Ativos' },
    { value: 'inactive', label: 'Inativos' },
    { value: 'all', label: 'Todos' },
  ],
  orders: [
    { value: 'draft', label: 'Rascunho' },
    { value: 'confirmed', label: 'Confirmado' },
    { value: 'dispatched', label: 'Expedido' },
    { value: 'canceled', label: 'Cancelado' },
  ],
  receivables: [
    { value: 'open', label: 'Aberto' },
    { value: 'partially_paid', label: 'Parcialmente pago' },
    { value: 'paid', label: 'Pago' },
    { value: 'canceled', label: 'Cancelado' },
    { value: 'zero', label: 'Sem saldo' },
  ],
};
function ExportForm() {
  const session = useSession();
  const [resource, setResource] = useState<ExportResource>('customers');
  const [fields, setFields] = useState<ExportFields>(exportDefaults);
  const catalog = resource === 'customers' || resource === 'products';
  const set = (key: keyof ExportFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  let request: ExportRequest | null = null;
  let error = '';
  try {
    request = buildExportRequest(resource, fields);
  } catch {
    error =
      'Revise filtros: datas reais em AAAA-MM-DD, ordem por nome crescente com busca e limite válido.';
  }
  const field = (key: keyof ExportFields, label: string) => (
    <TextField
      key={key}
      label={label}
      value={fields[key]}
      onChangeText={(value) => set(key, value)}
    />
  );
  const allowed = resource !== 'receivables' || session.permissions.includes('receivables:read');
  return (
    <Screen
      title="Exportar CSV"
      description="Um arquivo por página, emitido pelo backend. Sem total global ou snapshot entre páginas."
    >
      <Panel title="Filtros">
        <View style={{ gap: space[3] }}>
          <Select
            label="Dados"
            value={resource}
            options={[
              { value: 'customers', label: 'Clientes' },
              { value: 'products', label: 'Produtos' },
              { value: 'orders', label: 'Pedidos' },
              { value: 'receivables', label: 'Recebíveis' },
            ]}
            onChange={(value) => {
              setResource(value);
              setFields({ ...exportDefaults, direction: value === 'orders' ? 'desc' : 'asc' });
            }}
          />
          <Select
            label="Situação"
            value={fields.status}
            options={[{ value: '', label: 'Padrão da API' }, ...statuses[resource]]}
            onChange={(value) => set('status', value)}
          />
          {catalog ? (
            <>
              {field('q', 'Prefixo do nome')}
              <Select
                label="Ordenar por"
                value={fields.sort}
                options={[
                  { value: 'name', label: 'Nome' },
                  { value: 'createdAt', label: 'Criação' },
                ]}
                onChange={(value) => set('sort', value)}
              />
              {resource === 'customers' ? (
                field('assignedTo', 'Responsável: UID ou unassigned (opcional)')
              ) : (
                <>
                  {field('categoryId', 'ID da categoria (opcional)')}
                  {field('sku', 'SKU exato (opcional)')}
                  <Select
                    label="Visível no catálogo"
                    value={fields.catalogVisible}
                    options={[
                      { value: '', label: 'Todos' },
                      { value: 'true', label: 'Sim' },
                      { value: 'false', label: 'Não' },
                    ]}
                    onChange={(value) => set('catalogVisible', value)}
                  />
                </>
              )}
            </>
          ) : (
            field('customerId', 'ID do cliente (opcional)')
          )}
          {resource === 'receivables' ? (
            <>
              {field('orderId', 'ID do pedido (opcional)')}
              {field('from', 'Vencimento inicial (AAAA-MM-DD)')}
              {field('to', 'Vencimento final (AAAA-MM-DD)')}
            </>
          ) : (
            <Select
              label="Direção"
              value={fields.direction}
              options={[
                { value: 'asc', label: 'Crescente' },
                { value: 'desc', label: 'Decrescente' },
              ]}
              onChange={(value) => set('direction', value)}
            />
          )}
          {field(
            'limit',
            catalog ? 'Registros por arquivo (1 a 100)' : 'Registros por arquivo (1 a 10)',
          )}
        </View>
      </Panel>
      {error ? (
        <Alert tone="warning" title="Filtros inválidos">
          {error}
        </Alert>
      ) : allowed && request ? (
        <ExportPages key={JSON.stringify(request)} request={request} />
      ) : (
        <Alert tone="danger" title="Sem permissão para recebíveis" />
      )}
      <Alert title="Arquivo para planilha">
        UTF-8 com BOM, ponto e vírgula e datas brasileiras. Preserve apóstrofos de proteção contra
        fórmulas. Página vazia pode ter continuação. Não há CSV de estoque no contrato.
      </Alert>
    </Screen>
  );
}
function ExportPages({ request }: { request: ExportRequest }) {
  const { api, tenantId } = useTenantApi();
  const [current, setCurrent] = useState(request);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ count: number | null; next: string | null } | null>(null);
  return (
    <Panel title={`Página CSV ${page}`}>
      <View style={{ gap: space[3] }}>
        <FileActions
          key={page}
          label="Obter página CSV"
          load={(signal) => exportPage(api, tenantId, current, signal)}
          onLoaded={(file) => setMeta({ count: file.rowCount, next: file.nextCursor })}
        />
        {meta ? (
          <Text>{`${meta.count} registros nesta página. ${meta.next ? 'Há continuação.' : 'Última página.'}`}</Text>
        ) : null}
        {meta?.next ? (
          <Button
            label="Próxima página CSV"
            variant="outline"
            onPress={() => {
              setCurrent(nextExportPage(request, meta.next!));
              setPage((v) => v + 1);
              setMeta(null);
            }}
          />
        ) : null}
        {page > 1 ? (
          <Button
            label="Reiniciar exportação"
            variant="ghost"
            onPress={() => {
              setCurrent(request);
              setPage(1);
              setMeta(null);
            }}
          />
        ) : null}
      </View>
    </Panel>
  );
}
