import { useEffect, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { PaymentCondition, PaymentMethod } from '@/api/types';
import { toApiError } from '@/api/errors';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { intentScope, usePendingIntent } from '@/lib/intent';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ChoiceChips,
  Dialog,
  Disclosure,
  EmptyState,
  Skeleton,
  Switch,
  Text,
  TextField,
} from '@/ui';
import { CalendarClock, Pencil, Plus, Wallet } from '@/ui/icons';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { useFinanceCommand, usePaymentConditions, usePaymentMethods } from './administrationApi';
import type { SettingCommand } from './commands';
import { Guidance, FilterTabs } from './FinanceParts';
import { FinanceNav } from './FinanceNav';
import {
  describeOffsets,
  describeWeights,
  formatDate,
  formatPercent,
  methodIcon,
  methodKindLabel,
  methodKinds,
  nameKey,
  previewAmounts,
  previewDueDates,
} from './presentation';

type Tab = 'condicoes' | 'formas';
type StatusFilter = 'active' | 'inactive' | 'all';
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Disponíveis' },
  { value: 'inactive', label: 'Inativas' },
  { value: 'all', label: 'Todas' },
];
const MAX_PAGES = 10;

/** Lista integral (até 10 páginas de 25) para filtrar e conferir nomes repetidos na tela. */
function useAllPages<T>(list: {
  query: {
    hasNextPage: boolean;
    isFetching: boolean;
    fetchNextPage: () => unknown;
    data?: { pages: unknown[] };
  };
  items: T[];
}) {
  const { query } = list;
  const pages = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (query.hasNextPage && !query.isFetching && pages < MAX_PAGES) query.fetchNextPage();
  }, [query, pages]);
  return list.items;
}

export function SettingsScreen() {
  const params = useLocalSearchParams<{ aba?: string }>();
  const tab: Tab = params.aba === 'formas' ? 'formas' : 'condicoes';
  return (
    <Screen
      title="Condições e formas de pagamento"
      description="Condição é quando o cliente paga (à vista, 30 dias…). Forma é como ele paga (Pix, dinheiro…)."
    >
      <FinanceNav />
      <FilterTabs<Tab>
        label="Cadastro"
        value={tab}
        onChange={(aba) => router.setParams({ aba })}
        options={[
          { value: 'condicoes', label: 'Condições de pagamento' },
          { value: 'formas', label: 'Formas de pagamento' },
        ]}
      />
      {tab === 'condicoes' ? <Conditions /> : <Methods />}
    </Screen>
  );
}

function ListHeader({
  guidance,
  filter,
  onFilter,
  action,
}: {
  guidance: string;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
  action: ReactNode;
}) {
  const compact = useLayoutSize() === 'compact';
  return (
    <View style={styles.headerBlock}>
      <Guidance>{guidance}</Guidance>
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <FilterTabs label="Situação" options={statusOptions} value={filter} onChange={onFilter} />
        {action}
      </View>
    </View>
  );
}

function SettingRow({
  title,
  details,
  active,
  onPress,
  last,
}: {
  title: string;
  details: string[];
  active: boolean;
  onPress: () => void;
  last: boolean;
}) {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={`Editar ${title}`}
      onPress={onPress}
      pressStyle={(s: InteractionState) => [
        styles.row,
        !last && styles.divider,
        (s.hovered || s.pressed) && styles.hover,
        showFocusRing(s) && focusRing(),
      ]}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        {details.map((d) => (
          <Text key={d} variant="small" color={color.textSecondary}>
            {d}
          </Text>
        ))}
      </View>
      <Badge label={active ? 'Disponível' : 'Inativa'} tone={active ? 'success' : 'neutral'} />
      <Pencil size={16} color={color.textSecondary} />
    </Touchable>
  );
}

function ListBody<T>({
  query,
  rows,
  empty,
  render,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  rows: T[];
  empty: ReactNode;
  render: (row: T, last: boolean) => ReactNode;
}) {
  return (
    <View style={styles.panel}>
      {query.isPending ? (
        <View style={styles.pad}>
          <Skeleton height={18} />
          <Skeleton height={18} width="60%" />
        </View>
      ) : query.isError ? (
        <View style={styles.pad}>
          <Alert
            tone="danger"
            title="Não foi possível carregar"
            action={<Button label="Tentar de novo" size="sm" onPress={() => query.refetch()} />}
          >
            {toApiError(query.error).userMessage}
          </Alert>
        </View>
      ) : rows.length === 0 ? (
        empty
      ) : (
        rows.map((r, i) => render(r, i === rows.length - 1))
      )}
    </View>
  );
}

function Conditions() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const list = usePaymentConditions('all');
  const all = useAllPages(list);
  const rows = all.filter((c) => filter === 'all' || c.status === filter);
  const [editing, setEditing] = useState<PaymentCondition | 'new' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <ListHeader
        guidance="Condições aparecem para escolha ao criar um pedido. Os vencimentos contam a partir da confirmação do pedido."
        filter={filter}
        onFilter={setFilter}
        action={
          <Button
            label="Nova condição"
            icon={Plus}
            size="sm"
            onPress={() => {
              setSaved(null);
              setEditing('new');
            }}
          />
        }
      />
      {saved ? (
        <Alert tone="success" title="Condição salva">
          {saved}
        </Alert>
      ) : null}
      <ListBody
        query={list.query}
        rows={rows}
        empty={
          <EmptyState
            size="compact"
            icon={CalendarClock}
            title={
              filter === 'inactive' ? 'Nenhuma condição inativa' : 'Nenhuma condição cadastrada'
            }
            description="Crie as condições que a empresa oferece, como à vista, 30 dias ou 30/60/90."
          />
        }
        render={(c, last) => (
          <SettingRow
            key={c.id}
            title={c.name}
            active={c.status === 'active'}
            last={last}
            onPress={() => {
              setSaved(null);
              setEditing(c);
            }}
            details={[
              `${c.schedule.length === 1 ? '1 parcela' : `${c.schedule.length} parcelas`} · ${describeOffsets(c.schedule.map((p) => p.offsetDays))}`,
              ...(c.schedule.length > 1 ? [describeWeights(c.schedule.map((p) => p.weight))] : []),
            ]}
          />
        )}
      />
      {editing ? (
        <ConditionEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          record={editing === 'new' ? undefined : editing}
          names={all
            .filter((c) => editing === 'new' || c.id !== editing.id)
            .map((c) => nameKey(c.name))}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setSaved(message);
          }}
        />
      ) : null}
    </>
  );
}

function Methods() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const list = usePaymentMethods('all');
  const all = useAllPages(list);
  const rows = all.filter((m) => filter === 'all' || m.status === filter);
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <ListHeader
        guidance="Formas disponíveis aparecem na hora de registrar um pagamento. Desativar não altera pagamentos já registrados."
        filter={filter}
        onFilter={setFilter}
        action={
          <Button
            label="Nova forma"
            icon={Plus}
            size="sm"
            onPress={() => {
              setSaved(null);
              setEditing('new');
            }}
          />
        }
      />
      {saved ? (
        <Alert tone="success" title="Forma salva">
          {saved}
        </Alert>
      ) : null}
      <ListBody
        query={list.query}
        rows={rows}
        empty={
          <EmptyState
            size="compact"
            icon={Wallet}
            title={filter === 'inactive' ? 'Nenhuma forma inativa' : 'Nenhuma forma cadastrada'}
            description="Cadastre como seus clientes pagam: Pix, dinheiro, transferência, boleto…"
          />
        }
        render={(m, last) => (
          <SettingRow
            key={m.id}
            title={m.name}
            active={m.status === 'active'}
            last={last}
            onPress={() => {
              setSaved(null);
              setEditing(m);
            }}
            details={[methodKindLabel(m.kind)]}
          />
        )}
      />
      {editing ? (
        <MethodEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          record={editing === 'new' ? undefined : editing}
          names={all
            .filter((m) => editing === 'new' || m.id !== editing.id)
            .map((m) => nameKey(m.name))}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setSaved(message);
          }}
        />
      ) : null}
    </>
  );
}

/** Envio direto (sem segunda confirmação), preservando chave e corpo em resultado incerto. */
function useSettingCommand(kind: 'condition' | 'method', id: string) {
  const session = useSession();
  const scope = intentScope(
    session.user!.uid,
    session.tenantId!,
    'finance-setting',
    `${kind}:${id}`,
  );
  const pending = usePendingIntent(scope);
  const mutation = useFinanceCommand(scope);
  return { pending, mutation };
}

function SettingNotices({
  pending,
  mutation,
  onRecover,
}: {
  pending: ReturnType<typeof useSettingCommand>['pending'];
  mutation: ReturnType<typeof useSettingCommand>['mutation'];
  onRecover: () => void;
}) {
  return (
    <>
      {pending ? (
        <Alert
          tone="warning"
          title="Ainda não sabemos se o cadastro foi salvo"
          action={
            <Button
              label="Conferir cadastro"
              size="sm"
              variant="outline"
              loading={mutation.isPending}
              onPress={onRecover}
            />
          }
        >
          A conexão caiu antes da confirmação. Não crie outro: toque abaixo para conferir. Se já
          tiver sido salvo, nada será duplicado.
        </Alert>
      ) : null}
      {mutation.isError && !pending ? (
        <Alert tone="danger" title="Não foi possível salvar">
          {toApiError(mutation.error).code === 'CONFLICT'
            ? 'Este cadastro foi alterado em outro lugar. Feche, abra de novo e refaça a alteração.'
            : toApiError(mutation.error).userMessage}
        </Alert>
      ) : null}
    </>
  );
}

type Row = { offsetDays: number; weight: number };
const presets: { value: string; label: string; offsets: number[] }[] = [
  { value: 'cash', label: 'À vista', offsets: [0] },
  { value: 'net30', label: '30 dias', offsets: [30] },
  { value: '30_60', label: '30 e 60', offsets: [30, 60] },
  { value: '30_60_90', label: '30, 60 e 90', offsets: [30, 60, 90] },
];
const presetOf = (rows: Row[]) =>
  presets.find(
    (p) =>
      p.offsets.length === rows.length &&
      rows.every((r, i) => r.weight === 1 && r.offsetDays === p.offsets[i]),
  )?.value ?? 'custom';

function ConditionEditor({
  record,
  names,
  onClose,
  onSaved,
}: {
  record?: PaymentCondition;
  names: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const { pending, mutation } = useSettingCommand('condition', record?.id ?? 'new');
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [rows, setRows] = useState<Row[]>(
    record?.schedule.map((p) => ({ offsetDays: p.offsetDays, weight: p.weight })) ?? [],
  );
  const [mode, setMode] = useState(record ? presetOf(rows) : '');
  const [equal, setEqual] = useState(rows.every((r) => r.weight === (rows[0]?.weight ?? 1)));
  const [active, setActive] = useState(record ? record.status === 'active' : true);
  const [touched, setTouched] = useState(false);
  const locked = Boolean(pending) || mutation.isPending;
  const effective = equal ? rows.map((r) => ({ ...r, weight: 1 })) : rows;
  const nameError = !name.trim()
    ? 'Dê um nome à condição'
    : name.trim().length < 2
      ? 'Use pelo menos 2 letras'
      : names.includes(nameKey(name))
        ? 'Já existe uma condição com este nome'
        : undefined;
  const rowErrors = effective.map((r, i) =>
    !Number.isSafeInteger(r.offsetDays) || r.offsetDays < 0
      ? 'Informe os dias (0 ou mais)'
      : i > 0 && r.offsetDays < effective[i - 1]!.offsetDays
        ? 'Use prazo igual ou maior que o da parcela anterior'
        : !Number.isSafeInteger(r.weight) || r.weight < 1
          ? 'Parte deve ser 1 ou mais'
          : undefined,
  );
  const scheduleError = !mode
    ? 'Escolha os prazos'
    : rows.length === 0
      ? 'Adicione pelo menos uma parcela'
      : rowErrors.find(Boolean);
  const valid = !nameError && !scheduleError;
  const weights = effective.map((r) => r.weight);
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  const sample = 100_000;
  const amounts = !scheduleError ? previewAmounts(sample, weights) : [];
  const dates = !scheduleError
    ? previewDueDates(
        today,
        effective.map((r) => r.offsetDays),
      )
    : [];
  const pick = (value: string) => {
    setMode(value);
    const preset = presets.find((p) => p.value === value);
    if (preset) {
      setRows(preset.offsets.map((offsetDays) => ({ offsetDays, weight: 1 })));
      setEqual(true);
    } else if (rows.length === 0) setRows([{ offsetDays: 30, weight: 1 }]);
  };
  const command = (): SettingCommand => {
    const schedule = effective.map((r) => ({ offsetDays: r.offsetDays, weight: r.weight }));
    if (record)
      return {
        kind: 'update-condition',
        id: record.id,
        body: {
          expectedVersion: record.version,
          name: name.trim(),
          description: description.trim(),
          schedule,
          status: active ? 'active' : 'inactive',
        },
      };
    return {
      kind: 'create-condition',
      body: {
        name: name.trim(),
        description: description.trim(),
        ...(mode !== 'custom' && presetOf(effective) === mode
          ? { preset: mode as 'cash' | 'net30' | '30_60' | '30_60_90' }
          : { schedule }),
      },
    };
  };
  const send = (c: SettingCommand) =>
    mutation.mutate(c, {
      onSuccess: (result) => {
        const label = 'name' in result ? result.name : name.trim();
        onSaved(
          record
            ? `“${label}” atualizada.${active ? '' : ' Ela não aparece mais em novos pedidos.'}`
            : `“${label}” criada e já disponível para novos pedidos.`,
        );
      },
    });
  const update = (i: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog
      visible
      title={record ? 'Editar condição' : 'Nova condição de pagamento'}
      description="Defina em quantas vezes e em quantos dias o cliente paga."
      onClose={() => !mutation.isPending && onClose()}
      actions={
        <>
          <Button
            label="Cancelar"
            variant="ghost"
            disabled={mutation.isPending}
            onPress={onClose}
          />
          <Button
            label={record ? 'Salvar alterações' : 'Criar condição'}
            loading={mutation.isPending}
            disabled={locked}
            onPress={() => {
              setTouched(true);
              if (valid) send(command());
            }}
          />
        </>
      }
    >
      <SettingNotices
        pending={pending}
        mutation={mutation}
        onRecover={() => send(pending!.body as SettingCommand)}
      />
      <TextField
        label="Nome"
        placeholder="Ex.: 30/60 dias"
        value={name}
        onChangeText={setName}
        maxLength={100}
        editable={!locked}
        error={touched ? nameError : undefined}
      />
      <ChoiceChips
        label="Prazos"
        value={mode || null}
        onChange={pick}
        disabled={locked}
        error={touched && !mode ? 'Escolha os prazos' : undefined}
        options={[...presets, { value: 'custom', label: 'Personalizada', offsets: [] }].map(
          (p) => ({
            value: p.value,
            label: p.label,
          }),
        )}
      />
      {mode === 'custom' ? (
        <View style={styles.rows}>
          {effective.map((r, i) => (
            <View key={i} style={styles.installment}>
              <View style={styles.installmentHead}>
                <Text variant="smallStrong">{`${i + 1}ª parcela`}</Text>
                <Button
                  label={`Remover ${i + 1}ª parcela`}
                  size="sm"
                  variant="ghost"
                  disabled={locked || rows.length === 1}
                  onPress={() => setRows((current) => current.filter((_, j) => j !== i))}
                />
              </View>
              <View style={styles.installmentFields}>
                <View style={styles.flex}>
                  <TextField
                    label={`Dias da ${i + 1}ª parcela`}
                    inputMode="numeric"
                    value={Number.isNaN(r.offsetDays) ? '' : String(r.offsetDays)}
                    onChangeText={(v) =>
                      update(i, { offsetDays: v.trim() === '' ? NaN : Number(v.replace(/D/g, '')) })
                    }
                    editable={!locked}
                    hint="dias após a confirmação"
                    error={touched ? rowErrors[i] : undefined}
                  />
                </View>
                {!equal ? (
                  <View style={styles.flex}>
                    <TextField
                      label={`Parte da ${i + 1}ª parcela`}
                      inputMode="numeric"
                      value={Number.isNaN(r.weight) ? '' : String(r.weight)}
                      onChangeText={(v) =>
                        update(i, { weight: v.trim() === '' ? NaN : Number(v.replace(/D/g, '')) })
                      }
                      editable={!locked}
                      hint={
                        totalWeight > 0 && r.weight > 0
                          ? `${formatPercent((r.weight / totalWeight) * 100)} do valor`
                          : 'parte do valor'
                      }
                    />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <Button
            label="Adicionar parcela"
            icon={Plus}
            size="sm"
            variant="outline"
            disabled={locked || rows.length >= 12}
            onPress={() =>
              setRows((current) => [
                ...current,
                { offsetDays: (current.at(-1)?.offsetDays ?? 0) + 30, weight: 1 },
              ])
            }
          />
          {rows.length > 1 ? (
            <Switch
              label="Dividir o valor em partes iguais"
              description={
                equal
                  ? 'Cada parcela recebe o mesmo valor.'
                  : 'Informe a parte de cada parcela. Ex.: 1 e 2 = um terço e dois terços.'
              }
              value={equal}
              onChange={(v) => {
                setEqual(v);
                if (!v) setRows((current) => current.map((r) => ({ ...r, weight: r.weight || 1 })));
              }}
              disabled={locked}
            />
          ) : null}
          <Text variant="caption" color={color.textSecondary}>
            Até 12 parcelas. Os dias contam a partir da confirmação do pedido (0 = no mesmo dia).
          </Text>
        </View>
      ) : null}
      {mode && amounts.length ? (
        <View style={styles.preview}>
          <Text variant="smallStrong">
            {`Exemplo: pedido de ${formatCents(sample)} confirmado hoje (${formatDate(today)})`}
          </Text>
          {amounts.map((cents, i) => (
            <View key={i} style={styles.previewRow}>
              <Text variant="small">{`${i + 1}ª parcela · vence ${formatDate(dates[i]!)}`}</Text>
              <Text variant="small">{formatCents(cents)}</Text>
            </View>
          ))}
          <Text variant="caption" color={color.textSecondary}>
            Prévia ilustrativa. O valor exato de cada parcela é calculado ao confirmar o pedido, em
            dias corridos, sem ajuste para fins de semana ou feriados.
          </Text>
        </View>
      ) : touched && scheduleError && mode ? (
        <Text variant="small" color={color.danger}>
          {scheduleError}
        </Text>
      ) : null}
      {record ? (
        <Switch
          label="Disponível para novos pedidos"
          description="Desativar não altera pedidos já confirmados."
          value={active}
          onChange={setActive}
          disabled={locked}
        />
      ) : null}
      <Disclosure label="Mais detalhes" summary="descrição interna">
        <TextField
          label="Descrição"
          optional
          value={description}
          onChangeText={setDescription}
          maxLength={500}
          editable={!locked}
        />
      </Disclosure>
    </Dialog>
  );
}

function MethodEditor({
  record,
  names,
  onClose,
  onSaved,
}: {
  record?: PaymentMethod;
  names: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { pending, mutation } = useSettingCommand('method', record?.id ?? 'new');
  const [kind, setKind] = useState<PaymentMethod['kind'] | null>(record?.kind ?? null);
  const [name, setName] = useState(record?.name ?? '');
  const [active, setActive] = useState(record ? record.status === 'active' : true);
  const [touched, setTouched] = useState(false);
  const locked = Boolean(pending) || mutation.isPending;
  const nameError = !name.trim()
    ? 'Dê um nome à forma'
    : name.trim().length < 2
      ? 'Use pelo menos 2 letras'
      : names.includes(nameKey(name))
        ? 'Já existe uma forma com este nome'
        : undefined;
  const send = (c: SettingCommand) =>
    mutation.mutate(c, {
      onSuccess: (result) => {
        const label = 'name' in result ? result.name : name.trim();
        onSaved(
          record
            ? `“${label}” atualizada.${active ? '' : ' Ela não aparece mais ao registrar pagamentos.'}`
            : `“${label}” criada e já disponível para registrar pagamentos.`,
        );
      },
    });
  return (
    <Dialog
      visible
      title={record ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}
      description="Como o cliente paga. Aparece na hora de registrar um pagamento."
      onClose={() => !mutation.isPending && onClose()}
      actions={
        <>
          <Button
            label="Cancelar"
            variant="ghost"
            disabled={mutation.isPending}
            onPress={onClose}
          />
          <Button
            label={record ? 'Salvar alterações' : 'Criar forma'}
            loading={mutation.isPending}
            disabled={locked}
            onPress={() => {
              setTouched(true);
              if (!kind || nameError) return;
              send(
                record
                  ? {
                      kind: 'update-method',
                      id: record.id,
                      body: {
                        expectedVersion: record.version,
                        name: name.trim(),
                        kind,
                        status: active ? 'active' : 'inactive',
                      },
                    }
                  : { kind: 'create-method', body: { name: name.trim(), kind } },
              );
            }}
          />
        </>
      }
    >
      <SettingNotices
        pending={pending}
        mutation={mutation}
        onRecover={() => send(pending!.body as SettingCommand)}
      />
      <ChoiceChips
        label="Tipo"
        value={kind}
        disabled={locked}
        error={touched && !kind ? 'Escolha o tipo' : undefined}
        onChange={(next) => {
          // Nome acompanha o tipo enquanto a pessoa não escreveu outro.
          if (!name.trim() || name === methodKindLabel(kind ?? 'other'))
            setName(methodKindLabel(next));
          setKind(next);
        }}
        options={methodKinds.map((k) => ({
          value: k.value,
          label: k.label,
          icon: methodIcon(k.value),
        }))}
      />
      <TextField
        label="Nome"
        hint="Ex.: Pix, Pix Banco do Brasil, Dinheiro."
        value={name}
        onChangeText={setName}
        maxLength={100}
        editable={!locked}
        error={touched ? nameError : undefined}
      />
      {record ? (
        <Switch
          label="Disponível para registrar pagamentos"
          description="Desativar não altera pagamentos já registrados."
          value={active}
          onChange={setActive}
          disabled={locked}
        />
      ) : null}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  headerBlock: { gap: space[3] },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space[3],
  },
  toolbarCompact: { alignItems: 'stretch' },
  panel: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  pad: { padding: space[5], gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[5],
    minHeight: 56,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  rows: { gap: space[3] },
  installment: {
    gap: space[1],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  installmentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  installmentFields: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  preview: {
    gap: space[1] + 2,
    padding: space[3],
    borderRadius: 10,
    backgroundColor: color.surfaceSunken,
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space[2] },
});
