import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { PaymentCondition, PaymentMethod } from '@/api/types';
import { toApiError } from '@/api/errors';
import { ListPanel } from '@/features/catalog/ListStates';
import { FieldRow, FormSection } from '@/features/catalog/FormParts';
import { Screen } from '@/layout/Screen';
import { intentScope, usePendingIntent } from '@/lib/intent';
import { useSession } from '@/session/SessionContext';
import { Alert, Badge, Button, EmptyState, Select, Text, TextField } from '@/ui';
import { CircleDollarSign } from '@/ui/icons';
import { useFinanceCommand, usePaymentConditions, usePaymentMethods } from './administrationApi';
import {
  conditionFormSchema,
  methodFormSchema,
  type ConditionValues,
  type MethodValues,
} from './administrationRules';
import { CommandConfirmation } from './CommandConfirmation';
import type { SettingCommand } from './commands';
import { FinanceNav } from './FinanceNav';

export function SettingsScreen() {
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const conditions = usePaymentConditions(status);
  const methods = usePaymentMethods(status);
  const [condition, setCondition] = useState<PaymentCondition | 'new' | null>(null);
  const [method, setMethod] = useState<PaymentMethod | 'new' | null>(null);
  return (
    <Screen
      title="Condições e formas de pagamento"
      description="Cadastros por empresa. Desativar impede novas seleções e mantém snapshots históricos de pedidos e recebimentos."
    >
      <FinanceNav />
      <Select
        label="Situação dos cadastros"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: 'Todos' },
          { value: 'active', label: 'Ativos' },
          { value: 'inactive', label: 'Inativos' },
        ]}
      />
      <Button label="Nova condição" variant="strong" onPress={() => setCondition('new')} />
      {condition ? (
        <ConditionEditor
          key={condition === 'new' ? 'new' : `${condition.id}:${condition.version}`}
          record={condition === 'new' ? undefined : condition}
          onClose={() => setCondition(null)}
        />
      ) : null}
      <Text variant="h3">Condições cadastradas</Text>
      <ListPanel
        query={conditions.query}
        count={conditions.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma condição nestes filtros"
            description="Cadastre preset ou de uma a doze parcelas com prazos e pesos."
          />
        }
      >
        {conditions.items.map((c) => (
          <FormSection key={c.id} title={c.name} description={c.description}>
            <Badge label={c.status === 'active' ? 'Ativa' : 'Inativa'} />
            <Text>
              {c.schedule
                .map((p, i) => `${i + 1}ª: ${p.offsetDays} dias, peso ${p.weight}`)
                .join(' · ')}
            </Text>
            <Text variant="caption">{`Versão ${c.version}`}</Text>
            <Button
              label={`Editar condição ${c.name}`}
              variant="outline"
              onPress={() => setCondition(c)}
            />
          </FormSection>
        ))}
      </ListPanel>
      <Button label="Nova forma" variant="strong" onPress={() => setMethod('new')} />
      {method ? (
        <MethodEditor
          key={method === 'new' ? 'new' : `${method.id}:${method.version}`}
          record={method === 'new' ? undefined : method}
          onClose={() => setMethod(null)}
        />
      ) : null}
      <Text variant="h3">Formas cadastradas</Text>
      <ListPanel
        query={methods.query}
        count={methods.items.length}
        empty={
          <EmptyState
            icon={CircleDollarSign}
            title="Nenhuma forma nestes filtros"
            description="Forma prevista no pedido é independente da forma efetiva do recebimento."
          />
        }
      >
        {methods.items.map((m) => (
          <FormSection key={m.id} title={m.name}>
            <Badge label={m.status === 'active' ? 'Ativa' : 'Inativa'} />
            <Text>{methodKinds.find((k) => k.value === m.kind)?.label}</Text>
            <Text variant="caption">{`Versão ${m.version}`}</Text>
            <Button
              label={`Editar forma ${m.name}`}
              variant="outline"
              onPress={() => setMethod(m)}
            />
          </FormSection>
        ))}
      </ListPanel>
    </Screen>
  );
}
const methodKinds: { value: PaymentMethod['kind']; label: string }[] = [
  { value: 'cash', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'card', label: 'Cartão' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'other', label: 'Outra' },
];

function useSettingCommand(kind: 'condition' | 'method', id: string, onSuccess: () => void) {
  const session = useSession();
  const scope = intentScope(
    session.user!.uid,
    session.tenantId!,
    'finance-setting',
    `${kind}:${id}`,
  );
  const pending = usePendingIntent(scope);
  const mutation = useFinanceCommand(scope);
  const [review, setReview] = useState<SettingCommand | null>(null);
  const send = () =>
    review &&
    mutation.mutate(review, {
      onSuccess: () => {
        setReview(null);
        onSuccess();
      },
      onError: () => setReview(null),
    });
  const notices = (
    <>
      {pending ? (
        <Alert
          tone="warning"
          title="Cadastro com resultado desconhecido"
          action={
            <Button
              label="Recuperar mesmo cadastro"
              loading={mutation.isPending}
              onPress={() => {
                mutation.reset();
                setReview(pending.body as SettingCommand);
              }}
            />
          }
        >
          Não crie outro cadastro. Chave, tipo e payload estão preservados para recuperar resultado
          original.
        </Alert>
      ) : null}
      {mutation.isError ? (
        <Alert
          tone="danger"
          title="Cadastro não confirmado"
        >{`${toApiError(mutation.error).code}: ${toApiError(mutation.error).userMessage}. Recarregue a lista antes de revisar versão conflitante.`}</Alert>
      ) : null}
      {mutation.isSuccess && mutation.data && 'id' in mutation.data ? (
        <Alert
          tone="success"
          title="Cadastro confirmado"
        >{`${mutation.data.name} · versão ${mutation.data.version}`}</Alert>
      ) : null}
      {review ? (
        <CommandConfirmation
          command={review}
          busy={mutation.isPending}
          error={mutation.error}
          onSend={send}
          onCancel={() => setReview(null)}
        />
      ) : null}
    </>
  );
  return {
    notices,
    locked: Boolean(pending) || mutation.isPending,
    review: (command: SettingCommand) => {
      mutation.reset();
      setReview(command);
    },
  };
}
function ConditionEditor({ record, onClose }: { record?: PaymentCondition; onClose: () => void }) {
  const { control, handleSubmit, reset, formState } = useForm<ConditionValues>({
    resolver: zodResolver(conditionFormSchema),
    defaultValues: {
      name: record?.name ?? '',
      description: record?.description ?? '',
      mode: record ? 'custom' : 'cash',
      schedule: record?.schedule ?? [{ offsetDays: 0, weight: 1 }],
      status: record?.status ?? 'active',
    },
  });
  const fields = useFieldArray({ control, name: 'schedule' });
  const mode = useWatch({ control, name: 'mode' });
  const scheduleValues = useWatch({ control, name: 'schedule' });
  const action = useSettingCommand('condition', record?.id ?? 'new', () => {
    if (record) onClose();
    else reset();
  });
  return (
    <FormSection
      title={record ? 'Editar condição' : 'Criar condição'}
      description="Prazos em dias corridos após confirmação. Pesos inteiros positivos. O servidor calcula calendário e distribuição dos centavos."
    >
      {action.notices}
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Nome da condição"
            value={field.value}
            onChangeText={field.onChange}
            maxLength={100}
            editable={!action.locked}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <TextField
            label="Descrição da condição"
            value={field.value}
            onChangeText={field.onChange}
            maxLength={500}
            editable={!action.locked}
            error={fieldState.error?.message}
          />
        )}
      />
      {!record ? (
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <Select
              label="Modelo de prazos"
              value={field.value}
              onChange={(next) => {
                field.onChange(next);
                if (next !== 'custom') fields.replace([{ offsetDays: 0, weight: 1 }]);
              }}
              disabled={action.locked}
              options={[
                { value: 'cash', label: 'À vista' },
                { value: 'net30', label: '30 dias' },
                { value: '30_60', label: '30 e 60 dias' },
                { value: '30_60_90', label: '30, 60 e 90 dias' },
                { value: 'custom', label: 'Personalizado' },
              ]}
            />
          )}
        />
      ) : null}
      {mode === 'custom' ? (
        <>
          {fields.fields.map((f, i) => (
            <FormSection key={f.id} title={`${i + 1}ª parcela`}>
              <FieldRow>
                <Controller
                  control={control}
                  name={`schedule.${i}.offsetDays`}
                  render={({ field, fieldState }) => (
                    <TextField
                      label={`Prazo da parcela ${i + 1}`}
                      value={Number.isNaN(field.value) ? '' : String(field.value)}
                      onChangeText={(v) => field.onChange(v === '' ? NaN : Number(v))}
                      inputMode="numeric"
                      editable={!action.locked}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name={`schedule.${i}.weight`}
                  render={({ field, fieldState }) => (
                    <TextField
                      label={`Peso da parcela ${i + 1}`}
                      value={Number.isNaN(field.value) ? '' : String(field.value)}
                      onChangeText={(v) => field.onChange(v === '' ? NaN : Number(v))}
                      inputMode="numeric"
                      editable={!action.locked}
                      error={fieldState.error?.message}
                    />
                  )}
                />
              </FieldRow>
              <Button
                label={`Remover parcela ${i + 1}`}
                variant="ghost"
                disabled={action.locked || fields.fields.length === 1}
                onPress={() => fields.remove(i)}
              />
            </FormSection>
          ))}
          <Button
            label="Adicionar parcela"
            variant="outline"
            disabled={action.locked || fields.fields.length >= 12}
            onPress={() =>
              fields.append({ offsetDays: scheduleValues.at(-1)?.offsetDays ?? 0, weight: 1 })
            }
          />
          {formState.errors.schedule?.root?.message || formState.errors.schedule?.message ? (
            <Text>
              {formState.errors.schedule.root?.message ?? formState.errors.schedule.message}
            </Text>
          ) : null}
        </>
      ) : null}
      {record ? (
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Select
              label="Situação da condição"
              value={field.value}
              disabled={action.locked}
              onChange={field.onChange}
              options={[
                { value: 'active', label: 'Ativa' },
                { value: 'inactive', label: 'Inativa' },
              ]}
            />
          )}
        />
      ) : null}
      <Button
        label="Revisar condição"
        variant="strong"
        disabled={action.locked}
        onPress={handleSubmit((v) =>
          action.review(
            record
              ? {
                  kind: 'update-condition',
                  id: record.id,
                  body: {
                    expectedVersion: record.version,
                    name: v.name,
                    description: v.description,
                    schedule: v.schedule,
                    status: v.status,
                  },
                }
              : {
                  kind: 'create-condition',
                  body: {
                    name: v.name,
                    description: v.description,
                    ...(v.mode === 'custom' ? { schedule: v.schedule } : { preset: v.mode }),
                  },
                },
          ),
        )}
      />
      <Button
        label="Fechar editor de condição"
        variant="ghost"
        disabled={action.locked}
        onPress={onClose}
      />
    </FormSection>
  );
}
function MethodEditor({ record, onClose }: { record?: PaymentMethod; onClose: () => void }) {
  const { control, handleSubmit, reset } = useForm<MethodValues>({
    resolver: zodResolver(methodFormSchema),
    defaultValues: {
      name: record?.name ?? '',
      kind: record?.kind ?? 'pix',
      status: record?.status ?? 'active',
    },
  });
  const action = useSettingCommand('method', record?.id ?? 'new', () => {
    if (record) onClose();
    else reset();
  });
  return (
    <FormSection title={record ? 'Editar forma' : 'Criar forma'}>
      {action.notices}
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Nome da forma"
            value={field.value}
            onChangeText={field.onChange}
            maxLength={100}
            editable={!action.locked}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <Select
            label="Tipo da forma"
            value={field.value}
            options={methodKinds}
            onChange={field.onChange}
            disabled={action.locked}
          />
        )}
      />
      {record ? (
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Select
              label="Situação da forma"
              value={field.value}
              options={[
                { value: 'active', label: 'Ativa' },
                { value: 'inactive', label: 'Inativa' },
              ]}
              onChange={field.onChange}
              disabled={action.locked}
            />
          )}
        />
      ) : null}
      <Button
        label="Revisar forma"
        variant="strong"
        disabled={action.locked}
        onPress={handleSubmit((v) =>
          action.review(
            record
              ? {
                  kind: 'update-method',
                  id: record.id,
                  body: {
                    expectedVersion: record.version,
                    name: v.name,
                    kind: v.kind,
                    status: v.status,
                  },
                }
              : { kind: 'create-method', body: { name: v.name, kind: v.kind } },
          ),
        )}
      />
      <Button
        label="Fechar editor de forma"
        variant="ghost"
        disabled={action.locked}
        onPress={onClose}
      />
    </FormSection>
  );
}
