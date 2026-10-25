import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { ApiError, toApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type {
  DueDateChange,
  DueDateChangeInput,
  DueDateChangeResult,
  FinancialState,
  Receivable,
} from '@/api/types';
import { useIntentKey } from '@/lib/idempotency';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, DateField, Dialog, Disclosure, Skeleton, Text, TextField } from '@/ui';
import { CalendarClock } from '@/ui/icons';
import { canReadFinance } from './FinanceAccess';
import { refreshAfterFinanceCommand } from './cacheUpdates';
import { formatDate, installmentLabel } from './presentation';
import { formatDateTime } from '@/lib/dates';

/** Só parcelas com saldo em aberto mudam de vencimento (quitada/cancelada ficam como estão). */
export function canChangeDueDate(title: Pick<Receivable, 'status' | 'outstandingCents'>) {
  return (
    (title.status === 'open' || title.status === 'partially_paid') && title.outstandingCents > 0
  );
}

/** Limites da nova data: hoje ou depois, sem passar da parcela anterior nem da seguinte. */
export function dueDateBounds(title: Receivable, state: FinancialState, today: string | null) {
  const ordered = [...state.titles].sort((a, b) => a.installmentNumber - b.installmentNumber);
  const index = ordered.findIndex((t) => t.id === title.id);
  const previous = ordered[index - 1]?.dueDate;
  const next = ordered[index + 1]?.dueDate;
  const min = [today, previous]
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  return { min, max: next, previous, next };
}

function useChangeDueDate(orderId: string) {
  const { api, tenantId, header } = useTenantApi();
  const cache = useQueryClient();
  return useMutation<DueDateChangeResult, unknown, { body: DueDateChangeInput; key: string }>({
    retry: false,
    mutationFn: ({ body, key }) =>
      unwrap(
        api.POST('/api/v1/orders/{id}/due-date-changes', {
          params: { header: { ...header, 'Idempotency-Key': key }, path: { id: orderId } },
          body,
        }),
      ),
    // Listas, filtros, painel e relatórios passam a usar a nova data assim que o servidor confirma.
    onSuccess: (result) => {
      void refreshAfterFinanceCommand(cache, tenantId, [orderId, result.change.receivableId]);
      void cache.invalidateQueries({ queryKey: ['tenant', tenantId, 'reports'] });
    },
  });
}

/**
 * "Alterar vencimento" da parcela: nova data, motivo e confirmação. Não mexe em valores,
 * pagamentos nem estoque; a correção fica no histórico com quem fez, quando e por quê.
 */
export function DueDateAction({
  title,
  state,
  today,
  blocked,
}: {
  title: Receivable;
  state: FinancialState;
  today: string | null;
  blocked: boolean;
}) {
  const { permissions } = useSession();
  const change = useChangeDueDate(title.orderId);
  const key = useIntentKey();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ from: string; to: string } | null>(null);
  if (!permissions.includes('receivables:manage')) return null;
  const current = state.titles.find((t) => t.id === title.id);
  const eligible = Boolean(current && canChangeDueDate(current));
  const bounds = dueDateBounds(title, state, today);

  const start = () => {
    change.reset();
    key.reset();
    setDate('');
    setReason('');
    setProblem(null);
    setDone(null);
    setOpen(true);
  };
  const close = () => {
    if (change.isPending) return;
    setOpen(false);
  };
  const submit = () => {
    const trimmed = reason.trim();
    if (!date) return setProblem('Escolha a nova data de vencimento.');
    if (date === title.dueDate) return setProblem('Escolha uma data diferente da atual.');
    if (bounds.min && date < bounds.min)
      return setProblem(
        bounds.previous && bounds.min === bounds.previous && bounds.previous !== today
          ? `A data não pode ser antes do vencimento da parcela anterior (${formatDate(bounds.previous)}).`
          : 'A data não pode ser anterior a hoje.',
      );
    if (bounds.max && date > bounds.max)
      return setProblem(
        `A data não pode passar do vencimento da parcela seguinte (${formatDate(bounds.max)}).`,
      );
    if (trimmed.length < 3) return setProblem('Explique o motivo em poucas palavras.');
    if (!current) return;
    setProblem(null);
    change.mutate(
      {
        key: key.current(),
        body: {
          expectedOrderVersion: state.orderVersion,
          expectedGuardVersion: state.guardVersion,
          receivableId: title.id,
          expectedVersion: current.version,
          dueDate: date,
          reason: trimmed,
        },
      },
      {
        onSuccess: (result) => {
          key.reset();
          setOpen(false);
          setDone({ from: result.change.previousDueDate, to: result.change.dueDate });
        },
        onError: (error) => {
          // Uma recusa definitiva troca de intenção; falha de rede repete com a mesma chave.
          if (!(error instanceof ApiError) || error.kind !== 'network') key.reset();
        },
      },
    );
  };
  const failure = change.error ? toApiError(change.error) : null;

  return (
    <View style={styles.root}>
      <Button
        label="Alterar vencimento"
        icon={CalendarClock}
        size="sm"
        variant="outline"
        disabled={!eligible || blocked}
        onPress={start}
      />
      {done ? (
        <Alert tone="success" title="Vencimento alterado">
          {`De ${formatDate(done.from)} para ${formatDate(done.to)}. Valores e pagamentos não mudaram.`}
        </Alert>
      ) : null}
      <Dialog
        visible={open}
        title="Alterar vencimento"
        description={`${installmentLabel(title.installmentNumber)} · vencimento atual ${formatDate(title.dueDate)}`}
        onClose={close}
        actions={
          <>
            <Button label="Cancelar" variant="ghost" disabled={change.isPending} onPress={close} />
            <Button
              label={date ? `Confirmar ${formatDate(date)}` : 'Confirmar'}
              loading={change.isPending}
              onPress={submit}
            />
          </>
        }
      >
        <View style={styles.form}>
          <DateField
            label="Novo vencimento"
            value={date}
            onChange={(value) => {
              setDate(value);
              setProblem(null);
            }}
            min={bounds.min}
            max={bounds.max}
            today={today ?? undefined}
            hint={
              bounds.max
                ? `Entre ${formatDate(bounds.min ?? title.dueDate)} e ${formatDate(bounds.max)} (parcela seguinte).`
                : 'Hoje ou uma data futura.'
            }
          />
          <TextField
            label="Motivo"
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              setProblem(null);
            }}
            placeholder="Ex.: combinado com a cliente"
            maxLength={500}
          />
          <Text variant="small" color={color.textSecondary}>
            Valores, pagamentos e estoque não mudam. A alteração fica registrada no histórico com
            seu nome, a data anterior, a nova e o motivo.
          </Text>
          {problem ? (
            <Alert tone="warning" title="Revise a alteração">
              {problem}
            </Alert>
          ) : null}
          {failure ? (
            <Alert tone="danger" title="Vencimento não alterado">
              {failure.userMessage}
            </Alert>
          ) : null}
        </View>
      </Dialog>
    </View>
  );
}

/** Correções anteriores desta parcela (mais recente primeiro). */
export function DueDateHistory({ receivableId }: { receivableId: string }) {
  const { api, tenantId, header } = useTenantApi();
  const allowed = canReadFinance(useSession());
  const history = useQuery({
    queryKey: queryKeys.dueDateChanges(tenantId, receivableId),
    enabled: allowed,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/receivables/{id}/due-date-changes', {
          params: { header, path: { id: receivableId } },
          signal,
        }),
      ),
  });
  const items: DueDateChange[] = history.data?.items ?? [];
  if (!allowed || (history.isSuccess && items.length === 0)) return null;
  return (
    <Disclosure
      label="Correções de vencimento"
      summary={
        history.isSuccess ? `${items.length} registrada${items.length > 1 ? 's' : ''}` : undefined
      }
    >
      {history.isPending ? (
        <Skeleton height={18} />
      ) : history.isError ? (
        <Text variant="small" color={color.textSecondary}>
          {toApiError(history.error).userMessage}
        </Text>
      ) : (
        <View style={styles.history}>
          {items.map((c) => (
            <View key={c.id} style={styles.entry}>
              <Text variant="bodyStrong">{`${formatDate(c.previousDueDate)} → ${formatDate(c.dueDate)}`}</Text>
              <Text variant="small" color={color.textSecondary}>
                {`${formatDateTime(c.occurredAt)} · ${c.reason}`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2], alignItems: 'flex-start' },
  form: { gap: space[4] },
  history: { gap: space[3] },
  entry: { gap: 2 },
});
