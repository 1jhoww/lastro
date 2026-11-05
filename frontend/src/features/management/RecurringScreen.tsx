import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { RecurringExpense } from '@/api/types';
import { ListPanel } from '@/features/catalog/ListStates';
import { FinanceNav } from '@/features/finance/FinanceNav';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Badge,
  Button,
  ConfirmDialog,
  CurrencyInput,
  DataTable,
  DateField,
  Dialog,
  EmptyState,
  IconButton,
  Panel,
  Select,
  Text,
  TextField,
  useToast,
  type Column,
} from '@/ui';
import { CirclePause, CirclePlay, Pencil, Plus, Repeat } from '@/ui/icons';
import {
  useCreateCategory,
  useCreateRecurring,
  useExpenseCategories,
  useGenerateRecurring,
  useRecurringCommand,
  useRecurringExpenses,
  useSeedCategories,
  useUpdateRecurring,
} from './api';
import { CommandError, Stack, messageOf } from './Parts';
import { frequencyCopy, recurringStatusCopy } from './presentation';

const frequencies = (['monthly', 'quarterly', 'yearly'] as const).map((value) => ({
  value,
  label: frequencyCopy[value],
}));
const dueDays = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `Dia ${i + 1}`,
}));

/** Despesas que se repetem. Os títulos saem sozinhos, até 35 dias antes do vencimento. */
export function RecurringScreen() {
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const toast = useToast();
  const manage = permissions.includes('payables:manage');
  const { query, items } = useRecurringExpenses();
  const command = useRecurringCommand();
  const generate = useGenerateRecurring();
  const [form, setForm] = useState<RecurringExpense | 'new' | null>(null);
  const [ending, setEnding] = useState<RecurringExpense | null>(null);
  const columns: Column<RecurringExpense>[] = [
    {
      key: 'description',
      label: 'Despesa',
      flex: 3,
      render: (r) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {r.description}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {r.categoryName ?? 'Sem categoria'}
          </Text>
        </View>
      ),
    },
    {
      key: 'frequency',
      label: 'Frequência',
      width: 150,
      render: (r) => (
        <Text variant="small">{`${frequencyCopy[r.frequency]}, dia ${r.dueDay}`}</Text>
      ),
    },
    {
      key: 'next',
      label: 'Próximo vencimento',
      width: 150,
      render: (r) => (
        <Text variant="small">{r.nextDueDate ? formatIsoDate(r.nextDueDate) : '—'}</Text>
      ),
    },
    {
      key: 'status',
      label: 'Situação',
      width: 110,
      render: (r) => (
        <Badge
          label={recurringStatusCopy[r.status].label}
          tone={recurringStatusCopy[r.status].tone}
        />
      ),
    },
    {
      key: 'amount',
      label: 'Valor',
      width: 120,
      align: 'right',
      render: (r) => <Text variant="figure">{formatCents(r.amountCents)}</Text>,
    },
  ];
  const actions = (r: RecurringExpense) =>
    manage && r.status !== 'ended' ? (
      <View style={styles.actions}>
        <IconButton icon={Pencil} label={`Editar ${r.description}`} onPress={() => setForm(r)} />
        <IconButton
          icon={r.status === 'active' ? CirclePause : CirclePlay}
          label={`${r.status === 'active' ? 'Pausar' : 'Retomar'} ${r.description}`}
          onPress={() =>
            command.mutate({
              id: r.id,
              action: r.status === 'active' ? 'pause' : 'resume',
              expectedVersion: r.version,
            })
          }
        />
      </View>
    ) : null;
  return (
    <Screen
      title="Despesas recorrentes"
      description="Aluguel, internet e tudo que se repete. Os títulos são gerados até 35 dias antes do vencimento."
      actions={
        manage ? (
          <>
            <Button
              label="Gerar títulos agora"
              variant="outline"
              fullWidth={compact}
              loading={generate.isPending}
              onPress={() =>
                generate.mutate(undefined, {
                  onSuccess: (result) =>
                    toast.show(
                      result.created
                        ? `${result.created} título(s) gerado(s)`
                        : 'Nenhum título novo',
                    ),
                  onError: (error) => toast.show(messageOf(error), 'danger'),
                })
              }
            />
            <Button
              label="Nova recorrência"
              icon={Plus}
              variant="strong"
              fullWidth={compact}
              onPress={() => setForm('new')}
            />
          </>
        ) : null
      }
    >
      <FinanceNav />
      <CommandError error={command.error} title="Recorrência não alterada" />
      <ListPanel
        query={query}
        count={items.length}
        empty={
          <EmptyState
            icon={Repeat}
            title="Nenhuma despesa recorrente"
            description="Cadastre uma vez e o título aparece em Contas a pagar a cada vencimento."
            action={
              manage ? (
                <Button
                  label="Nova recorrência"
                  icon={Plus}
                  variant="strong"
                  onPress={() => setForm('new')}
                />
              ) : undefined
            }
          />
        }
      >
        <DataTable
          label="Despesas recorrentes"
          rows={items}
          keyOf={(r) => r.id}
          columns={columns}
          actions={actions}
          actionsWidth={96}
          renderCompact={(r) => (
            <View style={styles.compact}>
              <View style={styles.head}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {r.description}
                </Text>
                <Text variant="figure">{formatCents(r.amountCents)}</Text>
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`${frequencyCopy[r.frequency]}, dia ${r.dueDay}`}
              </Text>
            </View>
          )}
        />
      </ListPanel>
      <Categories manage={manage} />
      {form ? (
        <RecurringDialog
          recurrence={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onEnd={(r) => {
            setForm(null);
            setEnding(r);
          }}
        />
      ) : null}
      <ConfirmDialog
        visible={ending !== null}
        title="Encerrar recorrência?"
        description="Nenhum título novo será gerado. Os já lançados continuam em Contas a pagar."
        confirmLabel="Encerrar recorrência"
        loading={command.isPending}
        onCancel={() => setEnding(null)}
        onConfirm={() =>
          command.mutate(
            { id: ending!.id, action: 'end', expectedVersion: ending!.version },
            {
              onSuccess: () => {
                toast.show('Recorrência encerrada');
                setEnding(null);
              },
            },
          )
        }
      />
    </Screen>
  );
}

function RecurringDialog({
  recurrence: r,
  onClose,
  onEnd,
}: {
  recurrence: RecurringExpense | null;
  onClose: () => void;
  onEnd: (r: RecurringExpense) => void;
}) {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const toast = useToast();
  const categories = useExpenseCategories();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const [description, setDescription] = useState(r?.description ?? '');
  const [amountCents, setAmount] = useState(r?.amountCents ?? 0);
  const [categoryId, setCategoryId] = useState(r?.categoryId ?? '');
  const [beneficiaryName, setBeneficiary] = useState(r?.beneficiaryName ?? '');
  const [frequency, setFrequency] = useState<RecurringExpense['frequency']>(
    r?.frequency ?? 'monthly',
  );
  const [dueDay, setDueDay] = useState(String(r?.dueDay ?? 10));
  const [startDate, setStartDate] = useState(r?.startDate ?? today);
  const [endDate, setEndDate] = useState(r?.endDate ?? '');
  const pending = create.isPending || update.isPending;
  const valid = description.trim().length >= 2 && amountCents > 0;
  const done = () => {
    toast.show(r ? 'Recorrência salva' : 'Recorrência criada');
    onClose();
  };
  return (
    <Dialog
      visible
      title={r ? 'Editar recorrência' : 'Nova recorrência'}
      description={
        r ? 'Vale para os próximos lançamentos. Títulos pagos ou vencidos não mudam.' : undefined
      }
      onClose={pending ? () => {} : onClose}
      actions={
        <>
          {r ? (
            <Button label="Encerrar" variant="ghost" onPress={() => onEnd(r)} disabled={pending} />
          ) : null}
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={pending} />
          <Button
            label={r ? 'Salvar recorrência' : 'Criar recorrência'}
            variant="strong"
            loading={pending}
            disabled={!valid}
            onPress={() => {
              const common = {
                description: description.trim(),
                amountCents,
                dueDay: Number(dueDay),
                categoryId: categoryId || null,
                beneficiaryName: beneficiaryName.trim() || null,
                endDate: endDate || null,
              };
              if (r)
                update.mutate(
                  { id: r.id, body: { ...common, expectedVersion: r.version } },
                  { onSuccess: done },
                );
              else create.mutate({ ...common, frequency, startDate }, { onSuccess: done });
            }}
          />
        </>
      }
    >
      <Stack>
        <CommandError error={create.error ?? update.error} title="Recorrência não salva" />
        <TextField
          label="Descrição"
          value={description}
          onChangeText={setDescription}
          maxLength={200}
          hint="Ex.: Internet da loja"
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <CurrencyInput label="Valor" value={amountCents} onChange={setAmount} />
          </View>
          <View style={styles.flex}>
            <Select
              label="Categoria"
              value={categoryId || null}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={setCategoryId}
              optional
            />
          </View>
        </View>
        <TextField
          label="Beneficiário"
          value={beneficiaryName}
          onChangeText={setBeneficiary}
          maxLength={160}
          optional
        />
        <View style={styles.row}>
          {r ? null : (
            <View style={styles.flex}>
              <Select
                label="Frequência"
                value={frequency}
                options={frequencies}
                onChange={setFrequency}
              />
            </View>
          )}
          <View style={styles.flex}>
            <Select label="Vencimento" value={dueDay} options={dueDays} onChange={setDueDay} />
          </View>
        </View>
        <View style={styles.row}>
          {r ? null : (
            <View style={styles.flex}>
              <DateField label="Início" value={startDate} today={today} onChange={setStartDate} />
            </View>
          )}
          <View style={styles.flex}>
            <DateField
              label="Término"
              value={endDate}
              today={today}
              onChange={setEndDate}
              optional
            />
          </View>
        </View>
      </Stack>
    </Dialog>
  );
}

function Categories({ manage }: { manage: boolean }) {
  const categories = useExpenseCategories();
  const create = useCreateCategory();
  const seed = useSeedCategories();
  const [name, setName] = useState('');
  const rows = categories.data ?? [];
  return (
    <Panel
      title="Categorias de despesa"
      description="Agrupam as despesas nos relatórios."
      action={
        manage && rows.length === 0 && !categories.isPending ? (
          <Button
            label="Criar as mais comuns"
            size="sm"
            variant="outline"
            loading={seed.isPending}
            onPress={() => seed.mutate()}
          />
        ) : undefined
      }
    >
      <Stack>
        <CommandError error={create.error ?? seed.error} title="Categoria não criada" />
        {rows.length ? (
          <View style={styles.chips}>
            {rows.map((c) => (
              <Badge key={c.id} label={c.name} />
            ))}
          </View>
        ) : null}
        {manage ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                label="Nova categoria"
                hideLabel
                placeholder="Nova categoria"
                value={name}
                onChangeText={setName}
                maxLength={100}
              />
            </View>
            <Button
              label="Adicionar"
              variant="outline"
              loading={create.isPending}
              disabled={name.trim().length < 2}
              onPress={() =>
                create.mutate(name.trim(), {
                  onSuccess: () => setName(''),
                })
              }
            />
          </View>
        ) : null}
      </Stack>
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', gap: space[1] },
  compact: { gap: space[1] },
  head: { flexDirection: 'row', gap: space[3] },
  row: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
