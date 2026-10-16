import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Customer } from '@/api/types';
import { DetailColumns, Fact, Facts } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useAssignCustomer, useCustomer, useSetCustomerStatus } from '@/features/customers/api';
import { addressComplete, addressLine as formatAddress } from '@/features/customers/presentation';
import { memberLabel, useAssigneeLabel, useMembers } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { documentKind, formatDocument, formatPhone } from '@/lib/document';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Badge, Button, ConfirmDialog, Panel, Select, Text, useToast } from '@/ui';
import { Pencil, RotateCcw, Archive } from '@/ui/icons';

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const customer = useCustomer(id);

  if (customer.isPending) return <RecordLoading title="Cliente" />;
  if (customer.isError || !customer.data)
    return (
      <RecordError
        title="Cliente"
        error={customer.error}
        backHref="/clientes"
        backLabel="Voltar para clientes"
        onRetry={() => customer.refetch()}
      />
    );
  return <CustomerView customer={customer.data} />;
}

function CustomerView({ customer: c }: { customer: Customer }) {
  const { permissions } = useSession();
  const admin = permissions.includes('customers:all:manage');
  const compact = useLayoutSize() === 'compact';
  const toast = useToast();
  const setStatus = useSetCustomerStatus(c.id);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const active = c.status === 'active';
  const kind = documentKind(c.document);

  const addressLine = formatAddress(c.address);

  return (
    <Screen
      title={c.name}
      description={c.tradeName ?? undefined}
      actions={
        <>
          <Link href={`/clientes/${c.id}/editar` as Href} asChild>
            <Button label="Editar" icon={Pencil} variant="outline" fullWidth={compact} />
          </Link>
          {admin ? (
            <Button
              label={active ? 'Desativar' : 'Reativar'}
              icon={active ? Archive : RotateCcw}
              variant={active ? 'ghost' : 'strong'}
              fullWidth={compact}
              onPress={() => setConfirmStatus(true)}
            />
          ) : null}
        </>
      }
    >
      {!active ? (
        <Alert tone="warning" title="Cliente inativo">
          Não aparece nas listas padrão nem pode receber novos pedidos. O histórico continua salvo.
        </Alert>
      ) : null}
      {active && !addressComplete(c.address) ? (
        <Alert
          tone="warning"
          title="Endereço incompleto"
          action={
            <Link href={`/clientes/${c.id}/editar` as Href} asChild>
              <Button label="Completar endereço" size="sm" variant="outline" />
            </Link>
          }
        >
          Cadastro anterior à obrigatoriedade do endereço. Consultas e pedidos seguem normais; o
          endereço será pedido na próxima edição.
        </Alert>
      ) : null}
      {setStatus.isError ? (
        <Alert tone="danger" title="Situação não alterada">
          {toApiError(setStatus.error).code === 'CONFLICT'
            ? 'O cadastro mudou enquanto você decidia. A versão atual já foi carregada; tente de novo.'
            : toApiError(setStatus.error).userMessage}
        </Alert>
      ) : null}

      <DetailColumns
        main={
          <>
            <Panel title="Dados">
              <Facts>
                <Fact label={kind ?? 'CPF ou CNPJ'} value={formatDocument(c.document)} />
                <Fact label="Telefone" value={formatPhone(c.phone)} />
                <Fact label="E-mail" value={c.email ?? ''} />
                <Fact label="Endereço" value={addressLine} />
              </Facts>
            </Panel>
            <Panel title="Observações">
              <Text variant="body" color={c.notes ? color.text : color.textSecondary} selectable>
                {c.notes || 'Nenhuma observação.'}
              </Text>
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Carteira">
              {admin ? <Assignment customer={c} /> : <Text variant="body">Na sua carteira.</Text>}
            </Panel>
            <Panel title="Registro">
              <View style={styles.facts}>
                <Fact
                  label="Situação"
                  value={
                    <Badge
                      label={active ? 'Ativo' : 'Inativo'}
                      tone={active ? 'success' : 'neutral'}
                    />
                  }
                />
                <Fact label="Cadastrado em" value={formatDate(c.createdAt)} />
                <Fact label="Última alteração" value={formatDate(c.updatedAt)} />
              </View>
            </Panel>
          </>
        }
      />

      <ConfirmDialog
        visible={confirmStatus}
        title={active ? 'Desativar cliente?' : 'Reativar cliente?'}
        description={
          active
            ? 'O cliente sai das listas e não poderá receber novos pedidos. Pedidos e histórico ficam preservados, e você pode reativar depois.'
            : 'O cliente volta às listas e pode receber pedidos de novo.'
        }
        confirmLabel={active ? 'Desativar cliente' : 'Reativar cliente'}
        tone={active ? 'danger' : 'strong'}
        loading={setStatus.isPending}
        onCancel={() => setConfirmStatus(false)}
        onConfirm={() =>
          setStatus.mutate(
            { active: !active, expectedVersion: c.version },
            {
              onSuccess: () => toast.show(active ? 'Cliente desativado' : 'Cliente reativado'),
              onSettled: () => setConfirmStatus(false),
            },
          )
        }
      />
    </Screen>
  );
}

/** Transferência de carteira (somente administrador). */
function Assignment({ customer: c }: { customer: Customer }) {
  const label = useAssigneeLabel();
  const members = useMembers(true);
  const assign = useAssignCustomer(c.id);
  const toast = useToast();
  const [pending, setPending] = useState<string | null | undefined>(undefined);

  const options = [
    { value: 'none', label: 'Sem responsável' },
    ...(members.data ?? [])
      .filter((m) => m.role === 'seller' && (m.status === 'active' || m.id === c.assignedTo))
      .map((m) => ({
        value: m.id,
        label: memberLabel(m),
        description: m.status === 'active' ? undefined : 'Desativado',
      })),
  ];
  const err = assign.error ? toApiError(assign.error) : null;

  return (
    <View style={styles.facts}>
      <Fact label="Responsável" value={label(c.assignedTo)} />
      <Select
        label="Transferir para"
        value={c.assignedTo ?? 'none'}
        options={options}
        disabled={members.isPending || assign.isPending}
        hint="Só vendedores ativos podem receber clientes."
        onChange={(v) => {
          const next = v === 'none' ? null : v;
          if (next !== c.assignedTo) setPending(next);
        }}
      />
      {err ? (
        <Alert tone="danger" title="Carteira não alterada">
          {err.code === 'INVALID_ASSIGNEE'
            ? 'Esse vendedor não está mais ativo. Escolha outro.'
            : err.userMessage}
        </Alert>
      ) : null}
      <ConfirmDialog
        visible={pending !== undefined}
        title="Transferir cliente?"
        description={`Passa de "${label(c.assignedTo)}" para "${label(pending ?? null)}". O responsável anterior deixa de ver este cliente e os pedidos dele; o novo não recebe pedidos antigos.`}
        confirmLabel="Transferir cliente"
        tone="strong"
        loading={assign.isPending}
        onCancel={() => setPending(undefined)}
        onConfirm={() =>
          assign.mutate(
            { assignedTo: pending ?? null, expectedVersion: c.version },
            {
              onSuccess: () => toast.show('Carteira atualizada'),
              onSettled: () => setPending(undefined),
            },
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({ facts: { gap: space[4], paddingTop: space[1] } });
