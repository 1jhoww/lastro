import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { ManagementOverview } from '@/api/types';
import { FilterTabs, Metric, MetricStrip } from '@/features/finance/FinanceParts';
import { FinanceNav } from '@/features/finance/FinanceNav';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { addDays, firstOfMonth, formatIsoDate, shiftMonth } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Button,
  CurrencyInput,
  DataTable,
  DateField,
  Dialog,
  Panel,
  Skeleton,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { useFinanceSettings, useManagementOverview, useUpdateFinanceSettings } from './api';
import { CommandError, Stack, SummaryRow } from './Parts';
import { formatMargin } from './presentation';

type Period = 'month' | 'last-month' | '90d';
const periods: { value: Period; label: string }[] = [
  { value: 'month', label: 'Este mês' },
  { value: 'last-month', label: 'Mês passado' },
  { value: '90d', label: 'Últimos 90 dias' },
];
const horizons: { value: '30' | '60' | '90'; label: string }[] = [
  { value: '30', label: '30 dias' },
  { value: '60', label: '60 dias' },
  { value: '90', label: '90 dias' },
];
function rangeOf(period: Period, today: string) {
  if (period === 'month') return { from: firstOfMonth(today), to: today };
  if (period === '90d') return { from: addDays(today, -89), to: today };
  const from = shiftMonth(firstOfMonth(today), -1);
  return { from, to: addDays(firstOfMonth(today), -1) };
}

/** Painel do Lastro Gestão: caixa, previsão e resultado, sempre vindos dos registros da empresa. */
export function ManagementDashboard() {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const [period, setPeriod] = useState<Period>('month');
  const [horizon, setHorizon] = useState<'30' | '60' | '90'>('30');
  const overview = useManagementOverview({ ...rangeOf(period, today), horizonDays: horizon });
  const data = overview.data;
  return (
    <Screen title="Painel de gestão" description="O que entrou, o que saiu e o que está previsto.">
      <FinanceNav />
      <FilterTabs label="Período" options={periods} value={period} onChange={setPeriod} />
      {overview.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar o painel"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => overview.refetch()}
            />
          }
        >
          {toApiError(overview.error).userMessage}
        </Alert>
      ) : null}
      {overview.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando">
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={96} />
          <Skeleton width="100%" height={220} />
        </View>
      ) : null}
      {data ? (
        <>
          <Cash data={data} />
          <MetricStrip>
            {[
              <Linked key="pay" href="/financeiro/pagar">
                <Metric
                  label="Total a pagar"
                  cents={data.payables.openCents}
                  caption={`${formatCents(data.payables.next7DaysCents)} em 7 dias`}
                />
              </Linked>,
              <Linked key="receive" href="/financeiro/receber">
                <Metric
                  label="Total a receber"
                  cents={data.receivables.openCents}
                  caption={`${formatCents(data.receivables.next7DaysCents)} em 7 dias`}
                />
              </Linked>,
              <Linked key="overdue-pay" href="/financeiro/pagar?situacao=overdue">
                <Metric
                  label="Contas vencidas"
                  cents={data.payables.overdueCents}
                  caption="A pagar"
                  tone="danger"
                />
              </Linked>,
              <Linked key="overdue-receive" href="/financeiro/receber?situacao=overdue">
                <Metric
                  label="Recebíveis vencidos"
                  cents={data.receivables.overdueCents}
                  caption="A receber"
                  tone="danger"
                />
              </Linked>,
            ]}
          </MetricStrip>
          {data.payables.supplierCreditsCents > 0 ? (
            <MetricStrip>
              {[
                <Linked key="credits" href="/financeiro/creditos-fornecedor">
                  <Metric
                    label="Créditos de fornecedores"
                    cents={data.payables.supplierCreditsCents}
                    caption="A usar ou a recuperar"
                  />
                </Linked>,
              ]}
            </MetricStrip>
          ) : null}
          <Panel
            title="Fluxo de caixa projetado"
            description={
              data.cash.balanceCents === null
                ? 'Parte de zero até você informar o saldo de caixa.'
                : 'Parte do saldo de caixa atual.'
            }
            action={
              <FilterTabs
                label="Horizonte"
                options={horizons}
                value={horizon}
                onChange={setHorizon}
              />
            }
          >
            <FlowTable rows={data.projected} />
            {data.payables.recurringForecastCents ? (
              <Text variant="small" color={color.textSecondary}>
                {`Inclui ${formatCents(data.payables.recurringForecastCents)} de despesas recorrentes ainda não lançadas.`}
              </Text>
            ) : null}
          </Panel>
          <Panel title="Realizado no período" description="Somente dinheiro que entrou ou saiu.">
            <Stack>
              <SummaryRow
                label="Recebimentos"
                value={formatCents(data.receivables.receivedInPeriodCents)}
              />
              <SummaryRow label="Pagamentos" value={formatCents(data.payables.paidInPeriodCents)} />
              <SummaryRow
                label="Saldo do período"
                value={formatCents(data.cash.periodBalanceCents)}
                strong
              />
            </Stack>
          </Panel>
          <Results data={data} />
          {data.notes.map((note) => (
            <Text key={note} variant="small" color={color.textSecondary}>
              {note}
            </Text>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function Linked({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href as Href} asChild>
      <Touchable
        accessibilityRole="link"
        pressStyle={(s: InteractionState) => [
          (s.hovered || s.pressed) && styles.hover,
          showFocusRing(s) && focusRing(),
        ]}
      >
        {children}
      </Touchable>
    </Link>
  );
}

function Cash({ data }: { data: ManagementOverview }) {
  const { permissions } = useSession();
  const [editing, setEditing] = useState(false);
  const balance = data.cash.balanceCents;
  return (
    <Panel
      title="Saldo de caixa"
      description={
        data.cash.openingDate
          ? `Calculado desde ${formatIsoDate(data.cash.openingDate)}`
          : 'Informe o saldo de uma data para acompanhar o caixa.'
      }
      action={
        permissions.includes('payables:manage') ? (
          <Button
            label={data.cash.openingDate ? 'Atualizar saldo' : 'Informar saldo'}
            size="sm"
            variant="outline"
            onPress={() => setEditing(true)}
          />
        ) : undefined
      }
    >
      <Text
        variant="figureLarge"
        color={balance !== null && balance < 0 ? color.danger : color.text}
      >
        {balance === null ? 'Não informado' : formatCents(balance)}
      </Text>
      {editing ? <CashDialog onClose={() => setEditing(false)} /> : null}
    </Panel>
  );
}

function CashDialog({ onClose }: { onClose: () => void }) {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const toast = useToast();
  const settings = useFinanceSettings();
  const update = useUpdateFinanceSettings();
  const [cents, setCents] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const openingBalanceCents = cents ?? settings.data?.openingBalanceCents ?? 0;
  const openingDate = date ?? settings.data?.openingDate ?? today;
  return (
    <Dialog
      visible
      title="Saldo de caixa"
      description="Conte o que há em caixa e no banco na data. Depois dela, o Lastro soma recebimentos e desconta pagamentos."
      onClose={update.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={update.isPending} />
          <Button
            label="Salvar saldo"
            variant="strong"
            loading={update.isPending}
            disabled={!settings.data}
            onPress={() =>
              update.mutate(
                {
                  expectedVersion: settings.data!.version,
                  openingBalanceCents,
                  openingDate,
                },
                {
                  onSuccess: () => {
                    toast.show('Saldo salvo');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <Stack>
        <CommandError error={update.error} title="Saldo não salvo" />
        <CurrencyInput label="Saldo" value={openingBalanceCents} onChange={setCents} />
        <DateField
          label="Data do saldo"
          value={openingDate}
          today={today}
          max={today}
          onChange={setDate}
        />
      </Stack>
    </Dialog>
  );
}

type Point = ManagementOverview['projected'][number];
/** Barra única por semana: uma série só, com a tabela ao lado dando os valores exatos. */
function FlowTable({ rows }: { rows: Point[] }) {
  const compact = useLayoutSize() === 'compact';
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.balanceCents)));
  const columns: Column<Point>[] = [
    {
      key: 'period',
      label: 'Período',
      flex: 2,
      render: (r) => <Text variant="small">{r.label}</Text>,
    },
    {
      key: 'in',
      label: 'Entradas',
      width: 120,
      align: 'right',
      render: (r) => <Text>{formatCents(r.inflowCents)}</Text>,
    },
    {
      key: 'out',
      label: 'Saídas',
      width: 120,
      align: 'right',
      render: (r) => <Text>{formatCents(r.outflowCents)}</Text>,
    },
    {
      key: 'balance',
      label: 'Saldo previsto',
      width: 132,
      align: 'right',
      render: (r) => (
        <Text variant="figure" color={r.balanceCents < 0 ? color.danger : color.text}>
          {formatCents(r.balanceCents)}
        </Text>
      ),
    },
  ];
  return (
    <View style={styles.flow}>
      <View style={styles.chart} accessibilityLabel="Saldo previsto por semana">
        {rows.map((r) => (
          <View
            key={r.key}
            style={styles.barSlot}
            accessible
            accessibilityLabel={`${r.label}: ${formatCents(r.balanceCents)}`}
          >
            <View
              style={[
                styles.bar,
                {
                  height: `${Math.max(2, (Math.abs(r.balanceCents) / max) * 100)}%`,
                  backgroundColor: r.balanceCents < 0 ? color.danger : color.structure,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <DataTable
        label="Fluxo de caixa projetado"
        rows={rows}
        keyOf={(r) => r.key}
        columns={columns}
        renderCompact={(r) => (
          <View style={styles.flowRow}>
            <Text variant="small" style={styles.flex}>
              {r.label}
            </Text>
            <Text variant="figure" color={r.balanceCents < 0 ? color.danger : color.text}>
              {formatCents(r.balanceCents)}
            </Text>
          </View>
        )}
        stacked={compact}
      />
    </View>
  );
}

function Results({ data }: { data: ManagementOverview }) {
  const p = data.profitability;
  return (
    <Panel
      title="Rentabilidade"
      description="Visão gerencial do período, sem tributos e depreciação."
    >
      {p.revenueCents === 0 && p.operatingExpensesCents === 0 ? (
        <Text variant="body" color={color.textSecondary}>
          Sem vendas nem despesas neste período.
        </Text>
      ) : (
        <Stack>
          <SummaryRow label="Faturamento" value={formatCents(p.revenueCents)} />
          <SummaryRow label="Custo das mercadorias vendidas" value={formatCents(-p.cogsCents)} />
          <SummaryRow
            label={`Lucro bruto (margem ${formatMargin(p.grossMarginBp)})`}
            value={formatCents(p.grossProfitCents)}
          />
          <SummaryRow
            label="Despesas operacionais"
            value={formatCents(-p.operatingExpensesCents)}
          />
          {p.undeliveredLossCents ? (
            <SummaryRow
              label="Mercadorias cobradas e não entregues"
              value={formatCents(-p.undeliveredLossCents)}
            />
          ) : null}
          <SummaryRow
            label="Resultado estimado"
            value={formatCents(p.estimatedResultCents)}
            strong
          />
        </Stack>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[4] },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
  flow: { gap: space[4] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 96 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', maxWidth: 40, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  flowRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  flex: { flex: 1 },
});
