import { useState } from 'react';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { BonusReason } from '@/api/types';
import { useCreateBonus } from '@/features/bonuses/api';
import { BonusLines } from '@/features/bonuses/BonusLines';
import {
  bonusErrorMessage,
  reasonLabel,
  reasonOptions,
  type BonusLineDraft,
} from '@/features/bonuses/presentation';
import { FormActions, FormBody, FormGroup, Hint } from '@/features/catalog/FormParts';
import { CustomerCombobox, type PickedCustomer } from '@/features/orders/CustomerCombobox';
import { RequirePermission } from '@/features/session/RequirePermission';
import { memberLabel, useMembers } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatQuantity, toApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, ConfirmDialog, Select, Text, TextField, useToast } from '@/ui';

export default function NewBonusScreen() {
  return (
    <RequirePermission anyOf={['bonuses:grant']} title="Nova bonificação">
      <NewBonus />
    </RequirePermission>
  );
}

/**
 * Lançamento avulso, separado do Novo pedido: não cria pedido nem conta a receber. O estoque só
 * sai quando a pessoa confirma o resumo; repetir depois de falha de rede usa a mesma chave.
 */
function NewBonus() {
  const toast = useToast();
  const session = useSession();
  const me = session.user?.uid ?? '';
  const admin = session.role === 'administrator';
  const members = useMembers(admin && session.permissions.includes('users:manage'));
  const create = useCreateBonus();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<BonusLineDraft[]>([]);
  const [reason, setReason] = useState<BonusReason | ''>('');
  const [detail, setDetail] = useState('');
  const [notes, setNotes] = useState('');
  const [responsible, setResponsible] = useState(me);
  const [tried, setTried] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const changed = () => {
    // Outro conteúdo é outra intenção: nova Idempotency-Key no próximo envio.
    create.resetKey();
    create.reset();
  };
  const detailOk = reason !== 'other' || detail.trim().length >= 3;
  const ready = Boolean(customer) && lines.length > 0 && reason !== '' && detailOk;
  const responsibleOptions = (members.data ?? [])
    .filter((m) => m.status === 'active' || m.id === responsible)
    .map((m) => ({
      value: m.id,
      label: m.id === me ? `${memberLabel(m)} (você)` : memberLabel(m),
    }));

  const submit = () => {
    if (!customer || !reason || create.isPending) return;
    create.mutate(
      {
        customerId: customer.id,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: toApiQuantity(l.quantityMilli),
        })),
        reason,
        ...(reason === 'other' ? { reasonDetail: detail.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(admin && responsible && responsible !== me ? { responsibleUid: responsible } : {}),
      },
      {
        onSuccess: (bonus) => {
          setReviewing(false);
          toast.show('Bonificação registrada');
          router.replace(`/bonificacoes/${bonus.id}` as Href);
        },
        onError: () => setReviewing(false),
      },
    );
  };
  const error = create.error ? toApiError(create.error) : null;

  return (
    <Screen
      title="Nova bonificação"
      description="Lançamento avulso, sem pedido e sem cobrança. Para bonificar em uma venda, use o Novo pedido."
    >
      <FormBody>
        <View style={styles.raised}>
          <FormGroup title="Cliente">
            <CustomerCombobox
              value={customer}
              disabled={create.isPending}
              onChange={(c) => {
                setCustomer(c);
                changed();
              }}
            />
            {tried && !customer ? (
              <Alert tone="danger" title="Cliente obrigatório">
                Escolha o cliente que recebe a bonificação.
              </Alert>
            ) : null}
          </FormGroup>
        </View>

        <FormGroup title="Produtos" description="Ajuste a quantidade do produto para incluí-lo.">
          <BonusLines
            lines={lines}
            disabled={create.isPending}
            onChange={(next) => {
              setLines(next);
              changed();
            }}
          />
          {tried && !lines.length ? (
            <Alert tone="danger" title="Nenhum produto">
              Inclua ao menos um produto.
            </Alert>
          ) : null}
        </FormGroup>

        <FormGroup title="Motivo e responsável">
          <Select
            label="Motivo"
            value={reason}
            options={[{ value: '', label: 'Escolha o motivo' }, ...reasonOptions]}
            error={tried && !reason ? 'Escolha o motivo.' : undefined}
            onChange={(v) => {
              setReason(v as BonusReason | '');
              changed();
            }}
          />
          {reason === 'other' ? (
            <TextField
              label="Descrição do motivo"
              value={detail}
              maxLength={200}
              error={tried && !detailOk ? 'Descreva com pelo menos 3 caracteres.' : undefined}
              onChangeText={(v) => {
                setDetail(v);
                changed();
              }}
            />
          ) : null}
          {admin && members.data ? (
            <Select
              label="Responsável"
              value={responsible}
              options={responsibleOptions}
              onChange={(v) => {
                setResponsible(v);
                changed();
              }}
            />
          ) : (
            <Hint>A bonificação fica registrada em seu nome.</Hint>
          )}
          <TextField
            label="Observações"
            optional
            multiline
            maxLength={1000}
            value={notes}
            style={styles.notes}
            onChangeText={(v) => {
              setNotes(v);
              changed();
            }}
          />
        </FormGroup>

        {error ? (
          <Alert tone="danger" title="Bonificação não registrada">
            {bonusErrorMessage(error.code ?? '') ?? error.userMessage}
          </Alert>
        ) : null}
        <Hint>
          Depois de confirmada, a bonificação não pode ser cancelada nem editada. Para corrigir, o
          administrador registra um retorno total.
        </Hint>
        <FormActions>
          <Button
            label="Revisar bonificação"
            variant="strong"
            onPress={() => {
              setTried(true);
              if (ready) setReviewing(true);
            }}
          />
        </FormActions>
      </FormBody>

      <ConfirmDialog
        visible={reviewing}
        title="Confirmar bonificação?"
        description="Ao confirmar, os produtos saem do estoque agora. Depois do registro não há cancelamento nem edição: para corrigir, registre um retorno total. Não gera pedido nem conta a receber."
        confirmLabel="Confirmar e dar saída"
        tone="strong"
        loading={create.isPending}
        onConfirm={submit}
        onCancel={() => setReviewing(false)}
      >
        <View style={styles.summary} accessibilityLabel="Resumo da bonificação">
          <Text variant="smallStrong">{customer?.name ?? ''}</Text>
          {lines.map((l) => (
            <View key={l.productId} style={styles.summaryLine}>
              <Text variant="small" numberOfLines={2} style={styles.flex}>
                {l.name}
              </Text>
              <Text variant="small">{formatQuantity(l.quantityMilli, l.unit)}</Text>
            </View>
          ))}
          <Text variant="small" color={color.textSecondary}>
            {`Motivo: ${reason === 'other' ? detail.trim() : reason ? reasonLabel[reason] : ''}`}
          </Text>
        </View>
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Lista de clientes flutua sobre os grupos seguintes.
  raised: { zIndex: 20 },
  notes: { minHeight: 56, textAlignVertical: 'top' },
  summary: { gap: space[2] },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
