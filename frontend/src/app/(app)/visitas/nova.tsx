import { useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { VisitKind } from '@/api/types';
import { FieldRow, FormActions, FormBody, FormGroup, Hint } from '@/features/catalog/FormParts';
import { useCustomer } from '@/features/customers/api';
import {
  CustomerCombobox,
  customerDetail,
  type PickedCustomer,
} from '@/features/orders/CustomerCombobox';
import { useOrderList } from '@/features/orders/api';
import { shortOrderId, statusLabel, todayIn } from '@/features/orders/rules';
import { RequirePermission } from '@/features/session/RequirePermission';
import { useTenant } from '@/features/session/useTenant';
import { memberLabel, useMembers } from '@/features/users/api';
import { useCreateVisit } from '@/features/visits/api';
import { formatDate } from '@/lib/dates';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Alert, Button, ChoiceChips, DateField, Select, TextField, useToast } from '@/ui';
import { MapPin, Phone } from '@/ui/icons';

const kinds: { value: Exclude<VisitKind, 'delivery'>; label: string; icon: typeof MapPin }[] = [
  { value: 'in_person', label: 'Visita presencial', icon: MapPin },
  { value: 'remote', label: 'Contato remoto', icon: Phone },
];

export default function NewVisitScreen() {
  return (
    <RequirePermission anyOf={['visits:own:manage']} title="Registrar visita">
      <NewVisit />
    </RequirePermission>
  );
}

/** Mensagem para cada recusa do servidor, pelo código estável. */
function messageFor(code: string): string | undefined {
  switch (code) {
    case 'VISIT_DATE_IN_FUTURE':
      return 'A data da visita não pode estar no futuro.';
    case 'INVALID_RELATED_ORDER':
      return 'O pedido escolhido não pertence a este cliente. Escolha outro ou deixe sem pedido.';
    case 'RESOURCE_NOT_FOUND':
      return 'Cliente não encontrado na sua carteira. Ele pode ter sido transferido.';
    case 'INVALID_RESPONSIBLE':
      return 'O responsável escolhido não está mais ativo na empresa.';
    case 'FEATURE_NOT_IN_PLAN':
      return 'Visitas e recompra não fazem parte do plano contratado.';
    default:
      return undefined;
  }
}

function NewVisit() {
  const toast = useToast();
  const session = useSession();
  const me = session.user?.uid ?? '';
  const admin = session.role === 'administrator';
  const tenant = useTenant();
  const today = tenant.data ? todayIn(tenant.data.timezone) : todayIn();
  const params = useLocalSearchParams<{ customerId?: string }>();
  const preset = params.customerId || undefined;
  const presetCustomer = useCustomer(preset ?? '', Boolean(preset));
  const members = useMembers(admin && session.permissions.includes('users:manage'));
  const create = useCreateVisit();

  const [picked, setPicked] = useState<PickedCustomer | null>(null);
  const customer: PickedCustomer | null =
    picked ??
    (presetCustomer.data
      ? {
          id: presetCustomer.data.id,
          name: presetCustomer.data.name,
          detail: customerDetail(presetCustomer.data),
        }
      : null);
  const [visitDate, setVisitDate] = useState('');
  const date = visitDate || today;
  const [kind, setKind] = useState<Exclude<VisitKind, 'delivery'>>('in_person');
  const [responsible, setResponsible] = useState(me);
  const [notes, setNotes] = useState('');
  const [orderId, setOrderId] = useState('none');
  const [tried, setTried] = useState(false);

  const orders = useOrderList(
    { customerId: customer?.id, direction: 'desc' },
    25,
    Boolean(customer),
  );
  const orderOptions = [
    { value: 'none', label: 'Sem pedido relacionado' },
    ...orders.items.map((o) => ({
      value: o.id,
      label: `${shortOrderId(o.commercialId)} · ${statusLabel[o.status]}`,
      description: o.confirmedAt ? `Confirmado em ${formatDate(o.confirmedAt)}` : undefined,
    })),
  ];
  const responsibleOptions = (members.data ?? [])
    .filter((m) => m.status === 'active' || m.id === responsible)
    .map((m) => ({
      value: m.id,
      label: m.id === me ? `${memberLabel(m)} (você)` : memberLabel(m),
    }));

  const notesOk = notes.trim().length >= 3;
  const errors = {
    customer: tried && !customer ? 'Escolha o cliente atendido.' : undefined,
    date: date > today ? 'A data não pode estar no futuro.' : undefined,
    notes: tried && !notesOk ? 'Descreva o atendimento com pelo menos 3 caracteres.' : undefined,
  };
  const changed = () => {
    // Outro conteúdo é outra intenção: nova Idempotency-Key no próximo envio.
    create.resetKey();
    create.reset();
  };

  const submit = () => {
    setTried(true);
    if (!customer || !notesOk || errors.date || create.isPending) return;
    create.mutate(
      {
        customerId: customer.id,
        visitDate: date,
        kind,
        notes: notes.trim(),
        ...(admin && responsible && responsible !== me ? { responsibleUid: responsible } : {}),
        ...(orderId !== 'none' ? { orderId } : {}),
      },
      {
        onSuccess: () => {
          toast.show('Visita registrada');
          router.replace((preset ? `/clientes/${preset}` : '/visitas') as Href);
        },
      },
    );
  };
  const error = create.error ? toApiError(create.error) : null;

  return (
    <Screen
      title="Registrar visita"
      description="Registro do atendimento ao cliente. Não cria pedido, estoque nem financeiro."
    >
      <FormBody>
        <FormGroup title="Atendimento">
          <CustomerCombobox
            // Cliente vindo da ficha chega depois da montagem: remonta já mostrando a escolha.
            key={customer ? 'chosen' : 'empty'}
            value={customer}
            disabled={create.isPending || (Boolean(preset) && presetCustomer.isPending)}
            onChange={(c) => {
              setPicked(c);
              setOrderId('none');
              changed();
            }}
          />
          {errors.customer ? (
            <Alert tone="danger" title="Cliente obrigatório">
              {errors.customer}
            </Alert>
          ) : null}
          <FieldRow weights={[1, 2]}>
            <DateField
              label="Data da visita"
              value={date}
              max={today}
              today={today}
              error={errors.date}
              onChange={(v) => {
                setVisitDate(v);
                changed();
              }}
            />
            <ChoiceChips
              label="Tipo de atendimento"
              options={kinds}
              value={kind}
              onChange={(v) => {
                setKind(v);
                changed();
              }}
            />
          </FieldRow>
          {admin && members.data ? (
            <Select
              label="Responsável"
              value={responsible}
              options={responsibleOptions}
              hint="Quem realizou o atendimento."
              onChange={(v) => {
                setResponsible(v);
                changed();
              }}
            />
          ) : (
            <Hint>O atendimento fica registrado em seu nome.</Hint>
          )}
          <TextField
            label="Observações do atendimento"
            value={notes}
            maxLength={1000}
            multiline
            numberOfLines={4}
            style={styles.multiline}
            placeholder="O que foi tratado, combinados, próximos passos."
            error={errors.notes}
            onChangeText={(v) => {
              setNotes(v);
              changed();
            }}
          />
        </FormGroup>

        <FormGroup
          title="Pedido relacionado"
          description="Opcional. Nem toda visita resulta em pedido."
        >
          <Select
            label="Pedido"
            value={orderId}
            options={orderOptions}
            disabled={!customer || orders.query.isPending}
            hint={
              customer
                ? 'Pedidos deste cliente que você pode consultar.'
                : 'Escolha o cliente primeiro.'
            }
            onChange={(v) => {
              setOrderId(v);
              changed();
            }}
          />
        </FormGroup>

        {error ? (
          <Alert tone="danger" title="Visita não registrada">
            {messageFor(error.code) ?? error.userMessage}
          </Alert>
        ) : null}
        <FormActions>
          <Button
            label="Cancelar"
            variant="ghost"
            disabled={create.isPending}
            onPress={() => router.back()}
          />
          <Button
            label="Registrar visita"
            variant="strong"
            loading={create.isPending}
            onPress={submit}
          />
        </FormActions>
      </FormBody>
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  spacer: { height: space[2] },
});
