import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Purchase, PurchaseClosureBody } from '@/api/types';
import { formatIsoDate } from '@/lib/calendar';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Dialog, Panel, Select, Skeleton, Text, TextField, useToast } from '@/ui';
import { useClosePurchase, useClosurePreview, usePurchaseClosure } from './api';
import { CommandError, SummaryRow } from './Parts';
import { closureTreatmentCopy, supplierCreditKindCopy } from './presentation';

type Treatment = PurchaseClosureBody['treatment'];
type Kind = NonNullable<PurchaseClosureBody['excessAs']>;

const treatments = (Object.keys(closureTreatmentCopy) as Treatment[]).map((value) => ({
  value,
  label: closureTreatmentCopy[value].label,
}));
const kinds = (Object.keys(supplierCreditKindCopy) as Kind[]).map((value) => ({
  value,
  label: supplierCreditKindCopy[value],
}));

/** Encerra o que o fornecedor não entregará. A prévia vem do servidor e não pode ser desfeita. */
export function CloseBalanceDialog({
  purchase: p,
  onClose,
}: {
  purchase: Purchase;
  onClose: () => void;
}) {
  const toast = useToast();
  const [treatment, setTreatment] = useState<Treatment | ''>('');
  const [excessAs, setExcessAs] = useState<Kind | ''>('');
  const [reason, setReason] = useState('');
  const preview = useClosurePreview(p.id, treatment || null);
  const close = useClosePurchase(p.id);
  const impact = preview.data;
  const needsDestination = (impact?.excessCents ?? 0) > 0;
  const ready =
    Boolean(impact) && reason.trim().length >= 3 && (!needsDestination || excessAs !== '');
  return (
    <Dialog
      visible
      title="Encerrar saldo pendente?"
      description="O que já entrou no estoque e os pagamentos feitos não mudam. Depois de encerrar, a compra não recebe mais mercadoria nem permite estornar recebimentos."
      onClose={close.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={close.isPending} />
          <Button
            label="Encerrar saldo"
            variant="danger"
            loading={close.isPending}
            disabled={!ready}
            onPress={() =>
              close.mutate(
                {
                  expectedVersion: p.version,
                  treatment: treatment as Treatment,
                  reason: reason.trim(),
                  ...(needsDestination ? { excessAs: excessAs as Kind } : {}),
                  expectedUndeliveredCents: impact!.undeliveredValueCents,
                  expectedExcessCents: impact!.excessCents,
                },
                {
                  onSuccess: () => {
                    toast.show('Saldo encerrado');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <View style={styles.stack}>
        <CommandError error={close.error ?? preview.error} title="Saldo não encerrado" />
        <Select
          label="O que acontece com o valor não entregue"
          placeholder="Escolha"
          value={treatment}
          options={treatments}
          onChange={(value) => setTreatment(value as Treatment)}
        />
        {treatment ? (
          <Text variant="small" color={color.textSecondary}>
            {closureTreatmentCopy[treatment].hint}
          </Text>
        ) : null}
        {preview.isFetching && !impact ? <Skeleton width="100%" height={72} /> : null}
        {impact ? (
          <>
            <View style={styles.stack}>
              {impact.items.map((item) => (
                <SummaryRow
                  key={item.lineId}
                  label={`${item.undeliveredQuantity} ${item.name}`}
                  value={formatCents(item.undeliveredValueCents)}
                />
              ))}
              <SummaryRow
                label="Valor não entregue"
                value={formatCents(impact.undeliveredValueCents)}
                strong
              />
              <SummaryRow label="Já pago" value={formatCents(impact.paidCents)} />
              <SummaryRow label="Em aberto" value={formatCents(impact.openBalanceCents)} />
              {impact.treatment === 'abatement' ? (
                <SummaryRow label="Abatido dos títulos" value={formatCents(impact.abatedCents)} />
              ) : null}
            </View>
            {impact.titles.map((row) => (
              <Text key={row.payableId} variant="small" color={color.textSecondary}>
                {`Parcela de ${formatIsoDate(row.dueDate)}: ${formatCents(row.outstandingBeforeCents)} passa a ${formatCents(row.outstandingAfterCents)}`}
              </Text>
            ))}
            {needsDestination ? (
              <>
                <Alert tone="warning" title={`${formatCents(impact.excessCents)} pagos a maior`}>
                  Esse valor foi pago e não foi entregue. Diga como ele fica registrado.
                </Alert>
                <Select
                  label="Valor pago a maior"
                  placeholder="Escolha"
                  value={excessAs}
                  options={kinds}
                  onChange={(value) => setExcessAs(value as Kind)}
                />
              </>
            ) : null}
          </>
        ) : null}
        <TextField
          label="Motivo"
          value={reason}
          onChangeText={setReason}
          maxLength={500}
          multiline
        />
      </View>
    </Dialog>
  );
}

/** Registro do encerramento: o que faltou, a decisão tomada e o crédito que ela gerou. */
export function ClosurePanel({ purchase: p }: { purchase: Purchase }) {
  const { permissions } = useSession();
  const closure = usePurchaseClosure(p.id);
  const summary = p.closure!;
  return (
    <Panel title="Saldo encerrado">
      <View style={styles.stack}>
        <SummaryRow
          label="Decisão financeira"
          value={closureTreatmentCopy[summary.treatment].label}
        />
        <SummaryRow
          label="Valor não entregue"
          value={formatCents(summary.undeliveredValueCents)}
          strong
        />
        {summary.abatedCents ? (
          <SummaryRow label="Abatido dos títulos" value={formatCents(summary.abatedCents)} />
        ) : null}
        {summary.excessCents ? (
          <SummaryRow label="Pago a maior" value={formatCents(summary.excessCents)} />
        ) : null}
        <SummaryRow label="Encerrado em" value={formatIsoDate(summary.closedOn)} />
        {(closure.data?.items ?? []).map((item) => (
          <Text key={item.lineId} variant="small" color={color.textSecondary}>
            {`${item.name}: comprado ${item.orderedQuantity}, recebido ${item.receivedQuantity}, não entregue ${item.undeliveredQuantity}`}
          </Text>
        ))}
        <Text variant="small" color={color.textSecondary}>
          {summary.reason}
        </Text>
        {summary.creditId && permissions.includes('payables:read') ? (
          <Link href={`/financeiro/creditos-fornecedor/${summary.creditId}` as Href} asChild>
            <Button label="Ver crédito do fornecedor" variant="outline" fullWidth />
          </Link>
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
});
