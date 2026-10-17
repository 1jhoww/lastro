import { useEffect, useRef, useState } from 'react';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { ReportQuery, ReportView } from '@/api/types';
import { downloadMessage } from '@/features/files/contracts';
import { fileLease } from '@/features/files/fileEpoch';
import { stageFile } from '@/features/files/presentation';
import { ProductPicker } from '@/features/inventory/ProductPicker';
import { CustomerCombobox, type PickedCustomer } from '@/features/orders/CustomerCombobox';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { memberLabel, useMembers } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { addDays, firstOfMonth } from '@/lib/calendar';
import { useCooldown } from '@/lib/useCooldown';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { color, radius, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Button,
  ChoiceChips,
  DataTable,
  DateField,
  EmptyState,
  Segmented,
  Select,
  Skeleton,
  Text,
  type Column,
} from '@/ui';
import { ChevronLeft, ChevronRight, Download, FileText, SearchX, X } from '@/ui/icons';
import { reportFile, useReport } from './api';
import {
  categories,
  movementOptions,
  reports,
  type ReportCategory,
  type ReportEntry,
} from './catalog';
import { formatReportValue, periodLabel } from './format';

const PAGE = 25;
type Preset = 'default' | 'month' | 'last-month' | '30d' | 'year' | 'custom';
type Filters = {
  preset: Preset;
  from: string;
  to: string;
  status: string;
  customer: PickedCustomer | null;
  product: { id: string; name: string } | null;
  sellerUid: string;
  movement: string;
};
const emptyFilters: Filters = {
  preset: 'default',
  from: '',
  to: '',
  status: '',
  customer: null,
  product: null,
  sellerUid: '',
  movement: '',
};

function presetRange(preset: Preset, today: string): { from: string; to: string } | null {
  switch (preset) {
    case 'month':
      return { from: firstOfMonth(today), to: today };
    case 'last-month': {
      const end = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(end), to: end };
    }
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return null;
  }
}

/** Monta a consulta exatamente com os filtros que o relatório aceita. */
function toQuery(entry: ReportEntry, f: Filters): ReportQuery {
  const q: ReportQuery = {};
  if (entry.filters.includes('period') && (f.preset === 'custom' || f.preset !== 'default')) {
    if (f.from) q.from = f.from;
    if (f.to) q.to = f.to;
  }
  if (entry.filters.includes('status') && f.status)
    q.status = f.status as NonNullable<ReportQuery['status']>;
  if (entry.filters.includes('customer') && f.customer) q.customerId = f.customer.id;
  if (entry.filters.includes('product') && f.product) q.productId = f.product.id;
  if (entry.filters.includes('seller') && f.sellerUid) q.sellerUid = f.sellerUid;
  if (entry.filters.includes('movement') && f.movement)
    q.movement = f.movement as NonNullable<ReportQuery['movement']>;
  return q;
}

/**
 * Relatórios: análise aprofundada por categoria, sempre calculada no servidor para a empresa
 * ativa. Filtros mudam a consulta; exportações levam todas as linhas com os mesmos filtros.
 */
export function ReportsScreen() {
  const session = useSession();
  const params = useLocalSearchParams<{ relatorio?: string }>();
  const plan = session.membership?.plan.features ?? [];
  const allowedCategories = categories.filter(
    (c) => !c.permission || session.permissions.includes(c.permission),
  );
  const available = reports.filter(
    (r) =>
      allowedCategories.some((c) => c.value === r.category) &&
      (!r.feature || plan.includes(r.feature)),
  );
  const initial = available.find((r) => r.id === params.relatorio) ?? available[0]!;
  const [reportId, setReportId] = useState(initial.id);
  const entry = available.find((r) => r.id === reportId) ?? initial;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const query = toQuery(entry, filters);
  const periodInvalid =
    filters.preset === 'custom' && !!filters.from && !!filters.to && filters.from > filters.to;
  const result = useReport(entry.id, query, !periodInvalid);

  const choose = (id: ReportEntry['id']) => {
    setReportId(id);
    setFilters(emptyFilters);
    router.setParams({ relatorio: id });
  };
  const category = entry.category;
  const inCategory = available.filter((r) => r.category === category);

  return (
    <Screen
      title="Relatórios"
      description="Análise detalhada de vendas, financeiro e estoque, com filtros e exportação."
    >
      <View style={styles.nav}>
        {allowedCategories.length > 1 ? (
          <Segmented
            label="Categoria"
            value={category}
            options={allowedCategories.map((c) => ({ value: c.value, label: c.label }))}
            onChange={(value: ReportCategory) =>
              choose(available.find((r) => r.category === value)!.id)
            }
          />
        ) : null}
        <ChoiceChips
          label="Relatório"
          hideLabel
          value={entry.id}
          options={inCategory.map((r) => ({ value: r.id, label: r.short }))}
          onChange={choose}
        />
      </View>

      <View style={styles.card}>
        <ReportHeader entry={entry} view={result.data} query={query} disabled={periodInvalid} />
        <FilterBar
          entry={entry}
          filters={filters}
          today={today}
          onChange={setFilters}
          resolved={result.data?.report === entry.id ? result.data : undefined}
          invalid={periodInvalid}
        />
      </View>

      <ReportBody
        loading={result.isPending || (result.isPlaceholderData && result.isFetching)}
        error={result.isError ? result.error : null}
        onRetry={() => void result.refetch()}
        view={result.data?.report === entry.id ? result.data : undefined}
      />

      <View style={styles.footerLinks}>
        <Link href={'/relatorios/exportacoes' as Href} asChild>
          <Button label="Exportar cadastros em CSV" variant="ghost" size="sm" />
        </Link>
      </View>
    </Screen>
  );
}

function ReportHeader({
  entry,
  view,
  query,
  disabled,
}: {
  entry: ReportEntry;
  view: ReportView | undefined;
  query: ReportQuery;
  disabled: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  const current = view?.report === entry.id ? view : undefined;
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.flex}>
        <Text variant="h3" accessibilityRole="header">
          {entry.title}
        </Text>
        <Text variant="small" color={color.textSecondary}>
          {current
            ? `${current.description} ${current.period ? `· ${periodLabel(current)}` : ''}`
            : ' '}
        </Text>
      </View>
      <View style={styles.exports}>
        {/* Nova consulta, novo estado: um erro antigo não fica sob outros filtros. */}
        <ExportButton
          key={`csv:${entry.id}:${JSON.stringify(query)}`}
          entry={entry}
          query={query}
          format="csv"
          disabled={disabled || !current}
        />
        <ExportButton
          key={`pdf:${entry.id}:${JSON.stringify(query)}`}
          entry={entry}
          query={query}
          format="pdf"
          disabled={disabled || !current}
        />
      </View>
    </View>
  );
}

function ExportButton({
  entry,
  query,
  format,
  disabled,
}: {
  entry: ReportEntry;
  query: ReportQuery;
  format: 'csv' | 'pdf';
  disabled: boolean;
}) {
  const { api, tenantId } = useTenantApi();
  const cooldown = useCooldown();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const task = useRef<AbortController | null>(null);
  useEffect(() => () => task.current?.abort(), []);
  const run = async () => {
    if (busy || cooldown.seconds) return;
    setBusy(true);
    setError(null);
    const abort = new AbortController();
    task.current = abort;
    const check = fileLease();
    try {
      const file = await reportFile(api, tenantId, entry.id, query, format, abort.signal);
      check();
      if (task.current !== abort) return;
      const presentation = stageFile(file);
      // Web baixa direto; no celular abre a folha do sistema para salvar ou compartilhar.
      await presentation.save();
      if (Platform.OS === 'web') setTimeout(presentation.dispose, 60_000);
    } catch (e) {
      if (task.current !== abort) return;
      const apiError = toApiError(e);
      cooldown.wait(apiError.retryAfterSeconds);
      setError(
        apiError.code === 'REPORT_TOO_LARGE' || apiError.code === 'DOCUMENT_PAGE_LIMIT'
          ? apiError.userMessage
          : downloadMessage(e),
      );
    } finally {
      if (task.current === abort) setBusy(false);
    }
  };
  return (
    <View style={styles.exportItem}>
      <Button
        label={format === 'csv' ? 'CSV' : 'PDF'}
        icon={format === 'csv' ? Download : FileText}
        variant="outline"
        size="sm"
        loading={busy}
        disabled={disabled || cooldown.seconds > 0}
        onPress={run}
        accessibilityLabel={`Exportar ${entry.title} em ${format.toUpperCase()}`}
      />
      {error ? (
        <Text variant="caption" color={color.danger} style={styles.exportError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const presetOptions: { value: Preset; label: string }[] = [
  { value: 'default', label: 'Padrão' },
  { value: 'month', label: 'Este mês' },
  { value: 'last-month', label: 'Mês anterior' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'year', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado' },
];

function FilterBar({
  entry,
  filters,
  today,
  onChange,
  resolved,
  invalid,
}: {
  entry: ReportEntry;
  filters: Filters;
  today: string;
  onChange: (f: Filters) => void;
  resolved: ReportView | undefined;
  invalid: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  const { permissions } = useSession();
  const seller = entry.filters.includes('seller');
  const members = useMembers(seller && permissions.includes('users:manage'));
  const [picking, setPicking] = useState(false);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const field = compact ? styles.fieldFull : styles.field;
  const usesPeriod = entry.filters.includes('period');
  const defaultHint =
    entry.id === 'overdue' || entry.id === 'delinquency'
      ? 'Padrão: vencidos nos últimos 12 meses'
      : entry.id === 'upcoming'
        ? 'Padrão: próximos 30 dias'
        : entry.id === 'receivables'
          ? 'Padrão: vencimentos do mês'
          : 'Padrão: mês atual até hoje';

  return (
    <View style={styles.filters}>
      {usesPeriod ? (
        <View style={styles.periodBlock}>
          <ChoiceChips
            label="Período"
            value={filters.preset}
            options={presetOptions}
            hint={filters.preset === 'default' ? defaultHint : undefined}
            onChange={(preset) => {
              const range = presetRange(preset, today);
              if (range) set({ preset, ...range });
              else if (preset === 'custom')
                set({
                  preset,
                  from: filters.from || resolved?.period?.from || firstOfMonth(today),
                  to: filters.to || resolved?.period?.to || today,
                });
              else set({ preset, from: '', to: '' });
            }}
          />
          {filters.preset === 'custom' ? (
            <View style={[styles.row, compact && styles.column]}>
              <View style={field}>
                <DateField
                  label="De"
                  value={filters.from}
                  today={today}
                  onChange={(from) => set({ from })}
                />
              </View>
              <View style={field}>
                <DateField
                  label="Até"
                  value={filters.to}
                  today={today}
                  onChange={(to) => set({ to })}
                  error={
                    invalid ? 'A data final deve ser igual ou posterior à inicial.' : undefined
                  }
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.row, compact && styles.column]}>
        {entry.statuses ? (
          <View style={field}>
            <Select
              label="Situação"
              value={filters.status}
              options={[
                {
                  value: '',
                  label: entry.category === 'inventory' ? 'Produtos ativos' : 'Todas',
                },
                ...entry.statuses.filter((s) => s.value !== 'active'),
              ]}
              onChange={(status) => set({ status })}
            />
          </View>
        ) : null}
        {seller && permissions.includes('users:manage') ? (
          <View style={field}>
            <Select
              label="Responsável"
              value={filters.sellerUid}
              options={[
                { value: '', label: 'Todos' },
                ...(members.data ?? []).map((m) => ({ value: m.id, label: memberLabel(m) })),
              ]}
              onChange={(sellerUid) => set({ sellerUid })}
            />
          </View>
        ) : null}
        {entry.filters.includes('movement') ? (
          <View style={field}>
            <Select
              label="Tipo de movimentação"
              value={filters.movement}
              options={[{ value: '', label: 'Todos' }, ...movementOptions]}
              onChange={(movement) => set({ movement })}
            />
          </View>
        ) : null}
        {entry.filters.includes('product') ? (
          <View style={[field, styles.picker]}>
            <Text variant="smallStrong">Produto</Text>
            <View style={styles.pickerRow}>
              <Button
                label={filters.product ? filters.product.name : 'Todos os produtos'}
                variant="outline"
                onPress={() => setPicking(true)}
                fullWidth
              />
              {filters.product ? (
                <Button
                  label="Limpar"
                  icon={X}
                  variant="ghost"
                  size="sm"
                  onPress={() => set({ product: null })}
                />
              ) : null}
            </View>
            <ProductPicker
              visible={picking}
              onClose={() => setPicking(false)}
              onPick={(item) => {
                set({ product: { id: item.productId, name: item.name } });
                setPicking(false);
              }}
            />
          </View>
        ) : null}
      </View>
      {entry.filters.includes('customer') ? (
        <View style={[styles.customer, compact && styles.fieldFull]}>
          <CustomerCombobox
            key={filters.customer?.id ?? 'all'}
            value={filters.customer}
            onChange={(customer) => set({ customer })}
          />
          {filters.customer ? (
            <Button
              label="Todos os clientes"
              icon={X}
              variant="ghost"
              size="sm"
              onPress={() => set({ customer: null })}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ReportBody({
  loading,
  error,
  onRetry,
  view,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  view: ReportView | undefined;
}) {
  // A new result always starts on its first page.
  const rows = view?.rows;
  const [paging, setPaging] = useState({ rows, page: 0 });
  const page = paging.rows === rows ? paging.page : 0;
  const setPage = (next: (current: number) => number) => setPaging({ rows, page: next(page) });
  if (error && !view) {
    const apiError = toApiError(error);
    return (
      <Alert
        tone={apiError.status === 422 ? 'warning' : 'danger'}
        title={
          apiError.code === 'REPORT_TOO_LARGE' || apiError.code === 'REPORT_RANGE_TOO_LARGE'
            ? 'Consulta grande demais'
            : apiError.status === 403
              ? 'Relatório indisponível para seu acesso'
              : 'Não foi possível gerar o relatório'
        }
        action={
          apiError.status >= 500 || apiError.status === 0 ? (
            <Button label="Tentar novamente" size="sm" variant="ghost" onPress={onRetry} />
          ) : null
        }
      >
        {apiError.userMessage}
      </Alert>
    );
  }
  if (loading || !view)
    return (
      <View style={styles.loading} accessibilityLabel="Gerando relatório">
        <View style={styles.summary}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.metric}>
              <Skeleton height={12} width="60%" />
              <Skeleton height={22} width="80%" />
            </View>
          ))}
        </View>
        <Skeleton height={16} />
        <Skeleton height={16} />
        <Skeleton height={16} width="70%" />
      </View>
    );
  const pages = Math.max(1, Math.ceil(view.rows.length / PAGE));
  const visible = view.rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <View style={styles.body}>
      {view.filters.length ? (
        <Text variant="caption" color={color.textSecondary}>
          {view.filters.map((f) => `${f.label}: ${f.value}`).join(' · ')}
        </Text>
      ) : null}
      <Summary view={view} />
      <Chart view={view} />
      {view.rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nenhum registro encontrado"
          description="Ajuste o período ou os filtros para ampliar a consulta."
          size="compact"
        />
      ) : (
        <View style={styles.table}>
          <ReportTable view={view} rows={visible} />
          {pages > 1 ? (
            <View style={styles.pager}>
              <Text variant="small" color={color.textSecondary}>
                {`${page * PAGE + 1}–${Math.min((page + 1) * PAGE, view.rows.length)} de ${view.rows.length}`}
              </Text>
              <View style={styles.pagerButtons}>
                <Button
                  label="Anterior"
                  icon={ChevronLeft}
                  variant="ghost"
                  size="sm"
                  disabled={page === 0}
                  onPress={() => setPage((p) => p - 1)}
                />
                <Button
                  label="Próxima"
                  icon={ChevronRight}
                  variant="ghost"
                  size="sm"
                  disabled={page >= pages - 1}
                  onPress={() => setPage((p) => p + 1)}
                />
              </View>
            </View>
          ) : (
            <Text variant="caption" color={color.textSecondary} style={styles.count}>
              {`${view.rows.length} ${view.rows.length === 1 ? 'registro' : 'registros'}`}
            </Text>
          )}
        </View>
      )}
      {view.notes.map((note) => (
        <Text key={note} variant="caption" color={color.textSecondary}>
          {note}
        </Text>
      ))}
    </View>
  );
}

function Summary({ view }: { view: ReportView }) {
  const compact = useLayoutSize() === 'compact';
  return (
    <View style={styles.summary}>
      {view.summary.map((m) => (
        <View
          key={m.key}
          style={[styles.metric, compact && styles.metricCompact]}
          accessibilityLabel={`${m.label}: ${formatReportValue(m.kind, m.value, view.timezone)}`}
        >
          <Text variant="caption" color={color.textSecondary} numberOfLines={2}>
            {m.label}
          </Text>
          <Text
            variant="figure"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            color={
              m.tone === 'danger'
                ? color.danger
                : m.tone === 'warning'
                  ? color.warning
                  : m.tone === 'success'
                    ? color.success
                    : color.text
            }
          >
            {formatReportValue(m.kind, m.value, view.timezone)}
          </Text>
          {m.caption ? (
            <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
              {m.caption}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Barras simples quando a série ajuda a ler a evolução; sem eixos decorativos. */
function Chart({ view }: { view: ReportView }) {
  const chart = view.chart;
  if (!chart || chart.points.length < 2 || chart.points.length > 62) return null;
  const max = Math.max(...chart.points.map((p) => p.value));
  if (max <= 0) return null;
  const format = (value: number) => formatReportValue(chart.kind, value, view.timezone);
  return (
    <View style={styles.chart} accessibilityLabel={`Gráfico: ${chart.label}`}>
      <Text variant="smallStrong" color={color.textSecondary}>
        {chart.label}
      </Text>
      <View style={styles.bars}>
        {chart.points.map((p) => (
          <View
            key={p.label}
            style={styles.barSlot}
            accessible
            accessibilityLabel={`${p.label}: ${format(p.value)}`}
          >
            <View
              style={[
                styles.bar,
                p.value > 0 ? null : styles.barEmpty,
                { height: `${p.value > 0 ? Math.max(4, (p.value / max) * 100) : 2}%` },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.barLabels}>
        <Text variant="caption" color={color.textSecondary}>
          {chart.points[0]!.label}
        </Text>
        <Text variant="caption" color={color.textSecondary}>
          {`Maior valor ${format(max)}`}
        </Text>
        <Text variant="caption" color={color.textSecondary}>
          {chart.points.at(-1)!.label}
        </Text>
      </View>
    </View>
  );
}

type Row = ReportView['rows'][number] & { key: string };
function hrefFor(link: ReportView['rows'][number]['link']): Href | undefined {
  if (!link) return undefined;
  switch (link.kind) {
    case 'order':
      return `/pedidos/${link.id}` as Href;
    case 'customer':
      return `/clientes/${link.id}` as Href;
    case 'product':
      return `/estoque/${link.id}` as Href;
    case 'title':
      return `/financeiro/${link.id}` as Href;
  }
}

function ReportTable({ view, rows }: { view: ReportView; rows: ReportView['rows'] }) {
  const keyed: Row[] = rows.map((r, i) => ({ ...r, key: `${i}:${r.link?.id ?? ''}` }));
  const linked = keyed.every((r) => r.link);
  const columns: Column<Row>[] = view.columns.map((c, i) => ({
    key: c.key,
    label: c.label,
    align: c.align,
    flex: i === 0 && c.kind === 'text' ? 2 : c.kind === 'text' ? 1.4 : 1,
    render: (r) => (
      <Text
        variant={i === 0 ? 'smallStrong' : c.kind === 'money' ? 'figure' : 'small'}
        align={c.align}
        numberOfLines={2}
      >
        {formatReportValue(c.kind, r.cells[c.key], view.timezone)}
      </Text>
    ),
  }));
  const [first, ...rest] = view.columns;
  const main = view.columns.find((c) => c.kind === 'money') ?? rest.at(-1);
  return (
    <DataTable
      label={view.title}
      rows={keyed}
      keyOf={(r) => r.key}
      columns={columns}
      hrefOf={linked ? (r) => hrefFor(r.link)! : undefined}
      renderCompact={(r) => (
        <View style={styles.compactRow}>
          <View style={styles.compactHead}>
            <Text variant="smallStrong" style={styles.flex} numberOfLines={2}>
              {formatReportValue(first!.kind, r.cells[first!.key], view.timezone)}
            </Text>
            {main && main.key !== first!.key ? (
              <Text variant="figure">
                {formatReportValue(main.kind, r.cells[main.key], view.timezone)}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" color={color.textSecondary}>
            {rest
              .filter((c) => c.key !== main?.key)
              .map((c) => `${c.label}: ${formatReportValue(c.kind, r.cells[c.key], view.timezone)}`)
              .join(' · ')}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  nav: { gap: space[3] },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[4],
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space[4] },
  headerCompact: { flexDirection: 'column', alignItems: 'stretch', gap: space[3] },
  exports: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start', flexWrap: 'wrap' },
  exportItem: { gap: space[1], maxWidth: 260 },
  exportError: { maxWidth: 260 },
  filters: { gap: space[3] },
  periodBlock: { gap: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], alignItems: 'flex-start' },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  field: { width: 240 },
  fieldFull: { alignSelf: 'stretch' },
  picker: { gap: space[2] },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  customer: { maxWidth: 520, gap: space[1], alignItems: 'flex-start' },
  body: { gap: space[4] },
  loading: { gap: space[3] },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.border,
  },
  metric: {
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 140,
    gap: 2,
    paddingVertical: space[3],
    paddingRight: space[4],
  },
  metricCompact: { flexBasis: '45%', minWidth: 0 },
  chart: { gap: space[2] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: color.structure, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  barEmpty: { backgroundColor: color.border },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2] },
  table: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  pagerButtons: { flexDirection: 'row', gap: space[1] },
  count: { paddingHorizontal: space[4], paddingVertical: space[2] },
  compactRow: { gap: 2 },
  compactHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  footerLinks: { alignItems: 'flex-start', marginLeft: -space[3] },
});
