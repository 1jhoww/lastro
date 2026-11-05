import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { Purchase, PurchaseReceipt } from '@/api/types';
import { DetailColumns, Fact, Facts } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatIsoDate } from '@/lib/calendar';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity, toApiQuantity } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  CurrencyInput,
  DateField,
  Dialog,
  Panel,
  QuantityInput,
  Skeleton,
  Text,
  useToast,
} from '@/ui';
import { Ban, Check, PackageCheck, PackageX, Pencil, RotateCcw, Undo2 } from '@/ui/icons';
import {
  useConfirmPurchase,
  usePurchase,
  usePurchaseDecision,
  usePurchaseHistory,
  usePurchasePreview,
  usePurchaseReceipts,
  useReceivePurchase,
  useReverseReceipt,
} from './api';
import { CommandError, ReasonDialog, SummaryRow } from './Parts';
import { CloseBalanceDialog, ClosurePanel } from './PurchaseClosure';
import {
  installmentsTotal,
  lineUnit,
  pendingMilli,
  purchaseCode,
  purchaseEventCopy,
  purchaseStatusCopy,
} from './presentation';

export function PurchaseDetail({ id }: { id: string }) {
  const purchase = usePurchase(id);
  if (purchase.isPending) return <RecordLoading title="Compra" />;
  if (purchase.isError || !purchase.data)
    return (
      <RecordError
        title="Compra"
        error={purchase.error}
        backHref="/compras"
        backLabel="Voltar para compras"
        onRetry={() => purchase.refetch()}
      />
    );
  return <PurchaseView purchase={purchase.data} />;
}

type Modal = 'confirm' | 'receive' | 'cancel' | 'reopen' | 'close' | null;

function PurchaseView({ purchase: p }: { purchase: Purchase }) {
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const toast = useToast();
  const [modal, setModal] = useState<Modal>(null);
  const cancel = usePurchaseDecision(p.id, 'cancel');
  const reopen = usePurchaseDecision(p.id, 'reopen');
  const can = (permission: string) => permissions.includes(permission as never);
  const status = purchaseStatusCopy[p.status];
  const draft = p.status === 'draft';
  const awaiting = p.pendingReceipt;
  const canceled = p.status === 'canceled';
  const closed = p.status === 'closed';
  const partial = p.status === 'partially_received';
  const canEdit = can('purchases:edit');
  const canClose = partial && can('purchases:close');

  return (
    <Screen
      title={`Compra ${purchaseCode(p)}`}
      description={p.supplierName ?? 'Sem fornecedor'}
      actions={
        <>
          {draft && can('purchases:edit') ? (
            <Link href={`/compras/${p.id}/editar` as Href} asChild>
              <Button label="Editar" icon={Pencil} variant="outline" fullWidth={compact} />
            </Link>
          ) : null}
          {draft && can('purchases:confirm') ? (
            <Button
              label="Confirmar compra"
              icon={Check}
              variant="strong"
              fullWidth={compact}
              onPress={() => setModal('confirm')}
            />
          ) : null}
          {awaiting && can('purchases:receive') ? (
            <Button
              label="Receber mercadoria"
              icon={PackageCheck}
              variant="strong"
              fullWidth={compact}
              onPress={() => setModal('receive')}
            />
          ) : null}
        </>
      }
    >
      {draft ? (
        <Alert title="Rascunho">
          Nada mudou no estoque nem no financeiro. Ao confirmar, a compra gera os títulos a pagar.
        </Alert>
      ) : null}
      {canceled ? (
        <Alert tone="warning" title="Compra cancelada">
          {p.cancelReason ?? 'Cancelada.'}
        </Alert>
      ) : null}
      <DetailColumns
        main={
          <>
            <Panel title="Produtos" flush>
              {p.lines.map((line) => (
                <View key={line.id} style={styles.line}>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {line.name}
                    </Text>
                    <Text variant="small" color={color.textSecondary}>
                      {`${line.sku}, ${formatQuantity(fromApiQuantity(line.quantity), lineUnit(line))} a ${formatCents(line.unitCostCents)}`}
                    </Text>
                    {draft ? null : (
                      <Text variant="small" color={color.textSecondary}>
                        {closed
                          ? `Recebido ${formatQuantity(fromApiQuantity(line.receivedQuantity), lineUnit(line))}, não entregue ${formatQuantity(fromApiQuantity(line.undeliveredQuantity), lineUnit(line))}`
                          : `Recebido ${formatQuantity(fromApiQuantity(line.receivedQuantity), lineUnit(line))}, pendente ${formatQuantity(pendingMilli(line), lineUnit(line))}`}
                      </Text>
                    )}
                  </View>
                  <Text variant="figure">{formatCents(line.totalCents)}</Text>
                </View>
              ))}
            </Panel>
            {p.closure ? <ClosurePanel purchase={p} /> : null}
            <Receipts purchase={p} />
            <History id={p.id} />
          </>
        }
        side={
          <>
            <Panel title="Situação">
              <View style={styles.stack}>
                <Badge label={status.label} tone={status.tone} />
                <SummaryRow label="Produtos" value={formatCents(p.subtotalCents)} />
                {p.lineDiscountCents ? (
                  <SummaryRow
                    label="Descontos dos itens"
                    value={formatCents(-p.lineDiscountCents)}
                  />
                ) : null}
                {p.freightCents ? (
                  <SummaryRow label="Frete" value={formatCents(p.freightCents)} />
                ) : null}
                {p.otherCostsCents ? (
                  <SummaryRow label="Despesas adicionais" value={formatCents(p.otherCostsCents)} />
                ) : null}
                {p.discountCents ? (
                  <SummaryRow label="Desconto" value={formatCents(-p.discountCents)} />
                ) : null}
                <SummaryRow label="Total" value={formatCents(p.totalCents)} strong />
              </View>
            </Panel>
            <Panel title="Dados">
              <Facts>
                <Fact label="Data da compra" value={formatIsoDate(p.purchaseDate)} />
                <Fact
                  label="Previsão de entrega"
                  value={p.expectedDeliveryDate ? formatIsoDate(p.expectedDeliveryDate) : ''}
                />
                <Fact label="Condição de pagamento" value={p.paymentCondition?.name ?? ''} />
                <Fact label="Observações" value={p.notes} />
              </Facts>
            </Panel>
            {p.installments.length ? (
              <Panel title="Parcelas" flush>
                {p.installments.map((row) => (
                  <Link
                    key={row.number}
                    href={`/financeiro/pagar/${row.payableId}` as Href}
                    style={styles.installment}
                  >
                    <Text variant="body">{`${row.number}ª, ${formatIsoDate(row.dueDate)}`}</Text>
                    <Text variant="figure">{formatCents(row.amountCents)}</Text>
                  </Link>
                ))}
              </Panel>
            ) : null}
            {canClose || (canEdit && (draft || p.status === 'confirmed')) ? (
              <Panel title="Mais ações">
                <View style={styles.stack}>
                  {canClose ? (
                    <Button
                      label="Encerrar saldo pendente"
                      icon={PackageX}
                      variant="outline"
                      fullWidth
                      onPress={() => setModal('close')}
                    />
                  ) : null}
                  {canEdit && p.status === 'confirmed' ? (
                    <Button
                      label="Voltar a rascunho"
                      icon={RotateCcw}
                      variant="outline"
                      fullWidth
                      onPress={() => setModal('reopen')}
                    />
                  ) : null}
                  {canEdit && (draft || p.status === 'confirmed') ? (
                    <Button
                      label="Cancelar compra"
                      icon={Ban}
                      variant="ghost"
                      fullWidth
                      onPress={() => setModal('cancel')}
                    />
                  ) : null}
                </View>
              </Panel>
            ) : null}
          </>
        }
      />
      {modal === 'confirm' ? <ConfirmDialog_ purchase={p} onClose={() => setModal(null)} /> : null}
      {modal === 'receive' ? <ReceiveDialog purchase={p} onClose={() => setModal(null)} /> : null}
      {modal === 'close' ? <CloseBalanceDialog purchase={p} onClose={() => setModal(null)} /> : null}
      <ReasonDialog
        visible={modal === 'cancel'}
        title="Cancelar compra?"
        description="A compra e seus títulos ficam no histórico como cancelados."
        confirmLabel="Cancelar compra"
        loading={cancel.isPending}
        error={cancel.error}
        onClose={() => setModal(null)}
        onConfirm={(reason) =>
          cancel.mutate(
            { expectedVersion: p.version, reason },
            {
              onSuccess: () => {
                toast.show('Compra cancelada');
                setModal(null);
              },
            },
          )
        }
      />
      <ReasonDialog
        visible={modal === 'reopen'}
        title="Voltar a rascunho?"
        description="Os títulos desta compra serão cancelados. Uma nova confirmação gera títulos novos."
        confirmLabel="Voltar a rascunho"
        tone="strong"
        loading={reopen.isPending}
        error={reopen.error}
        onClose={() => setModal(null)}
        onConfirm={(reason) =>
          reopen.mutate(
            { expectedVersion: p.version, reason },
            {
              onSuccess: () => {
                toast.show('Compra voltou a rascunho');
                setModal(null);
              },
            },
          )
        }
      />
    </Screen>
  );
}

function ConfirmDialog_({ purchase: p, onClose }: { purchase: Purchase; onClose: () => void }) {
  const toast = useToast();
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const confirm = useConfirmPurchase(p.id);
  const condition = p.paymentCondition
    ? { id: p.paymentCondition.id, version: p.paymentCondition.version }
    : null;
  const preview = usePurchasePreview(p.id, condition, true);
  const [adjusted, setAdjusted] = useState<{ amountCents: number; dueDate: string }[] | null>(null);
  const rows = adjusted ?? preview.data?.installments ?? [];
  const edited = adjusted !== null;
  const change = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setAdjusted(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const sum = installmentsTotal(rows);
  const matches = sum === p.totalCents;
  return (
    <Dialog
      visible
      title="Confirmar compra?"
      description="Gera um título a pagar por parcela. O estoque só muda ao receber a mercadoria."
      onClose={confirm.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={confirm.isPending} />
          <Button
            label="Confirmar compra"
            variant="strong"
            loading={confirm.isPending}
            disabled={!condition || !matches}
            onPress={() =>
              confirm.mutate(
                {
                  expectedVersion: p.version,
                  ...(edited
                    ? {
                        installments: rows.map((r) => ({
                          amountCents: r.amountCents,
                          dueDate: r.dueDate,
                        })),
                      }
                    : {}),
                },
                {
                  onSuccess: () => {
                    toast.show('Compra confirmada');
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
        <CommandError error={confirm.error ?? preview.error} title="Compra não confirmada" />
        {!condition ? (
          <Alert tone="warning" title="Falta a condição de pagamento">
            Edite o rascunho e escolha a condição.
          </Alert>
        ) : null}
        {preview.isPending && condition ? <Skeleton width="70%" height={44} /> : null}
        {rows.map((row, index) => (
          <View key={index} style={styles.rowFields}>
            <View style={styles.flex}>
              <CurrencyInput
                label={`Parcela ${index + 1}`}
                value={row.amountCents}
                onChange={(amountCents) => change(index, { amountCents })}
              />
            </View>
            <View style={styles.flex}>
              <DateField
                label="Vencimento"
                value={row.dueDate}
                today={today}
                min={p.purchaseDate}
                onChange={(dueDate) => change(index, { dueDate })}
              />
            </View>
          </View>
        ))}
        {rows.length ? (
          <SummaryRow
            label={matches ? 'Soma das parcelas' : `Faltam ${formatCents(p.totalCents - sum)}`}
            value={formatCents(sum)}
            strong
          />
        ) : null}
      </View>
    </Dialog>
  );
}

function ReceiveDialog({ purchase: p, onClose }: { purchase: Purchase; onClose: () => void }) {
  const toast = useToast();
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const receive = useReceivePurchase(p.id);
  const open = p.lines.filter((l) => pendingMilli(l) > 0);
  const [quantities, setQuantities] = useState(
    () => new Map(open.map((l) => [l.id, pendingMilli(l)])),
  );
  const [receivedOn, setReceivedOn] = useState(today);
  const items = open.filter((l) => (quantities.get(l.id) ?? 0) > 0);
  return (
    <Dialog
      visible
      title="Receber mercadoria"
      description="Informe o que chegou de fato. O estoque e o custo médio são atualizados."
      onClose={receive.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={receive.isPending} />
          <Button
            label="Registrar recebimento"
            variant="strong"
            loading={receive.isPending}
            disabled={items.length === 0}
            onPress={() =>
              receive.mutate(
                {
                  expectedVersion: p.version,
                  receivedOn,
                  items: items.map((l) => ({
                    lineId: l.id,
                    quantity: toApiQuantity(quantities.get(l.id)!),
                  })),
                },
                {
                  onSuccess: () => {
                    toast.show('Recebimento registrado');
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
        <CommandError error={receive.error} title="Recebimento não registrado" />
        <DateField
          label="Data do recebimento"
          value={receivedOn}
          today={today}
          max={today}
          onChange={setReceivedOn}
        />
        {open.map((line) => (
          <View key={line.id} style={styles.receiveRow}>
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {line.name}
              </Text>
              <Text variant="small" color={color.textSecondary}>
                {`Comprado ${formatQuantity(fromApiQuantity(line.quantity), lineUnit(line))}, pendente ${formatQuantity(pendingMilli(line), lineUnit(line))}`}
              </Text>
            </View>
            <QuantityInput
              label={`Quantidade recebida de ${line.name}`}
              value={quantities.get(line.id) ?? 0}
              unit={lineUnit(line)}
              min={0}
              max={pendingMilli(line)}
              size="sm"
              onChange={(milli) => setQuantities((current) => new Map(current).set(line.id, milli))}
            />
          </View>
        ))}
      </View>
    </Dialog>
  );
}

function Receipts({ purchase }: { purchase: Purchase }) {
  const { permissions } = useSession();
  const toast = useToast();
  const receipts = usePurchaseReceipts(purchase.id);
  const reverse = useReverseReceipt();
  const [target, setTarget] = useState<PurchaseReceipt | null>(null);
  const items = receipts.data?.items ?? [];
  if (!items.length) return null;
  return (
    <Panel title="Recebimentos" flush>
      {items.map((receipt) => (
        <View key={receipt.id} style={styles.line}>
          <View style={styles.flex}>
            <Text variant="bodyStrong">{`${receipt.number}º em ${formatIsoDate(receipt.receivedOn)}`}</Text>
            <Text variant="small" color={color.textSecondary}>
              {receipt.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}
            </Text>
            {receipt.reversalReason ? (
              <Text variant="small" color={color.textSecondary}>
                {`Estornado: ${receipt.reversalReason}`}
              </Text>
            ) : null}
          </View>
          {receipt.status === 'reversed' ? (
            <Badge label="Estornado" tone="neutral" />
          ) : permissions.includes('purchases:receive') && purchase.status !== 'closed' ? (
            <Button
              label="Estornar"
              icon={Undo2}
              size="sm"
              variant="ghost"
              onPress={() => setTarget(receipt)}
            />
          ) : null}
        </View>
      ))}
      <ReasonDialog
        visible={target !== null}
        title="Estornar recebimento?"
        description="O que entrou volta a sair do estoque, com movimentação própria, e o custo médio é recalculado."
        confirmLabel="Estornar recebimento"
        loading={reverse.isPending}
        error={reverse.error}
        onClose={() => setTarget(null)}
        onConfirm={(reason) =>
          reverse.mutate(
            { id: target!.id, reason },
            {
              onSuccess: () => {
                toast.show('Recebimento estornado');
                setTarget(null);
              },
            },
          )
        }
      />
    </Panel>
  );
}

function History({ id }: { id: string }) {
  const history = usePurchaseHistory(id);
  const items = history.data?.items ?? [];
  if (!items.length) return null;
  return (
    <Panel title="Histórico" flush>
      {items.map((event) => (
        <View key={event.id} style={styles.line}>
          <View style={styles.flex}>
            <Text variant="body">{purchaseEventCopy[event.type] ?? event.type}</Text>
            {event.reason ? (
              <Text variant="small" color={color.textSecondary}>
                {event.reason}
              </Text>
            ) : null}
          </View>
          <Text variant="small" color={color.textSecondary}>
            {formatDateTime(event.occurredAt)}
          </Text>
        </View>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space[3] },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  installment: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  rowFields: { flexDirection: 'row', gap: space[3] },
  receiveRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
