import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { SupplierCredit, SupplierCreditMovement } from '@/api/types';
import { DetailColumns, Fact, Facts } from '@/features/catalog/DetailParts';
import { ListPanel } from '@/features/catalog/ListStates';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { FilterTabs } from '@/features/finance/FinanceParts';
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
  CurrencyInput,
  DataTable,
  DateField,
  Dialog,
  EmptyState,
  Panel,
  Select,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { HandCoins, ReceiptText, Undo2, Wallet } from '@/ui/icons';
import {
  useApplySupplierCredit,
  usePayables,
  useRecoverSupplierCredit,
  useReverseCreditMovement,
  useSupplierCredit,
  useSupplierCreditMovements,
  useSupplierCredits,
  type SupplierCreditFilter,
} from './api';
import { CommandError, ReasonDialog, SummaryRow } from './Parts';
import { supplierCreditKindCopy } from './presentation';

const views: { value: SupplierCreditFilter; label: string }[] = [
  { value: 'open', label: 'Com saldo' },
  { value: 'settled', label: 'Quitados' },
  { value: 'all', label: 'Todos' },
];

/** Créditos e valores a recuperar que vieram de compras encerradas com saldo. */
export function SupplierCreditsScreen() {
  const compact = useLayoutSize() === 'compact';
  const { permissions } = useSession();
  const manages = permissions.includes('payables:manage');
  // Who only consults starts on the whole history: there may be no balance left to show.
  const [view, setView] = useState<SupplierCreditFilter>(manages ? 'open' : 'all');
  const { query, items } = useSupplierCredits(view);
  const columns: Column<SupplierCredit>[] = [
    {
      key: 'supplier',
      label: 'Fornecedor',
      flex: 3,
      render: (c) => (
        <View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {c.supplierName}
          </Text>
          <Text variant="small" color={color.textSecondary} numberOfLines={1}>
            {`Compra #${c.purchaseCode}`}
          </Text>
        </View>
      ),
    },
    {
      key: 'kind',
      label: 'Tipo',
      flex: 2,
      render: (c) => <Text variant="small">{supplierCreditKindCopy[c.kind]}</Text>,
    },
    {
      key: 'issued',
      label: 'Registrado em',
      width: 120,
      render: (c) => <Text variant="small">{formatIsoDate(c.issuedOn)}</Text>,
    },
    {
      key: 'balance',
      label: 'Saldo',
      width: 128,
      align: 'right',
      render: (c) => <Text variant="figure">{formatCents(c.balanceCents)}</Text>,
    },
  ];
  return (
    <Screen
      title="Créditos de fornecedores"
      description={
        manages
          ? 'Valores de compras encerradas: use em outro título ou registre a devolução.'
          : 'Valores de compras encerradas e o histórico de cada crédito.'
      }
    >
      <FinanceNav />
      <FilterTabs label="Situação" options={views} value={view} onChange={setView} />
      <ListPanel
        query={query}
        count={items.length}
        empty={
          <EmptyState
            icon={Wallet}
            title="Nenhum crédito nesta visão"
            description="Ao encerrar o saldo de uma compra, o crédito ou o valor a recuperar aparece aqui."
          />
        }
      >
        <DataTable
          label="Créditos de fornecedores"
          rows={items}
          keyOf={(c) => c.id}
          hrefOf={(c) => `/financeiro/creditos-fornecedor/${c.id}` as Href}
          columns={columns}
          renderCompact={(c) => (
            <View style={[styles.stack, compact && styles.compact]}>
              <View style={styles.head}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {c.supplierName}
                </Text>
                <Text variant="figure">{formatCents(c.balanceCents)}</Text>
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`${supplierCreditKindCopy[c.kind]}, compra #${c.purchaseCode}`}
              </Text>
            </View>
          )}
        />
      </ListPanel>
    </Screen>
  );
}

export function SupplierCreditDetail({ id }: { id: string }) {
  const credit = useSupplierCredit(id);
  if (credit.isPending) return <RecordLoading title="Crédito" />;
  if (credit.isError || !credit.data)
    return (
      <RecordError
        title="Crédito"
        error={credit.error}
        backHref={'/financeiro/creditos-fornecedor' as Href}
        backLabel="Voltar para créditos"
        onRetry={() => credit.refetch()}
      />
    );
  return <CreditView credit={credit.data} />;
}

function CreditView({ credit: c }: { credit: SupplierCredit }) {
  const { permissions } = useSession();
  const compact = useLayoutSize() === 'compact';
  const [modal, setModal] = useState<'apply' | 'recover' | null>(null);
  const movements = useSupplierCreditMovements(c.id);
  const manage = permissions.includes('payables:manage') && c.hasBalance;
  return (
    <Screen
      title={supplierCreditKindCopy[c.kind]}
      description={c.supplierName}
      actions={
        manage ? (
          <>
            <Button
              label="Registrar devolução"
              icon={HandCoins}
              variant="outline"
              fullWidth={compact}
              onPress={() => setModal('recover')}
            />
            <Button
              label="Usar em um título"
              icon={ReceiptText}
              variant="strong"
              fullWidth={compact}
              onPress={() => setModal('apply')}
            />
          </>
        ) : null
      }
    >
      <DetailColumns
        main={
          <Panel title="Histórico" flush>
            {(movements.data?.items ?? []).length === 0 ? (
              <View style={styles.empty}>
                <Text variant="body" color={color.textSecondary}>
                  Nenhuma movimentação registrada.
                </Text>
              </View>
            ) : (
              movements.data!.items.map((m) => <MovementRow key={m.id} movement={m} />)
            )}
          </Panel>
        }
        side={
          <>
            <Panel title="Situação">
              <View style={styles.stack}>
                <Badge
                  label={c.status === 'open' ? 'Com saldo' : 'Quitado'}
                  tone={c.status === 'open' ? 'accent' : 'success'}
                />
                <SummaryRow label="Valor original" value={formatCents(c.originalCents)} />
                <SummaryRow label="Usado em títulos" value={formatCents(c.appliedCents)} />
                <SummaryRow label="Devolvido" value={formatCents(c.recoveredCents)} />
                <SummaryRow label="Saldo" value={formatCents(c.balanceCents)} strong />
              </View>
            </Panel>
            <Panel title="Dados">
              <Facts>
                <Fact label="Registrado em" value={formatIsoDate(c.issuedOn)} />
                <Fact label="Compra" value={`#${c.purchaseCode}`} />
              </Facts>
            </Panel>
            {permissions.includes('purchases:read') ? (
              <Link href={`/compras/${c.purchaseId}` as Href} asChild>
                <Button label="Ver a compra" variant="outline" fullWidth />
              </Link>
            ) : null}
          </>
        }
      />
      {modal === 'apply' ? <ApplyDialog credit={c} onClose={() => setModal(null)} /> : null}
      {modal === 'recover' ? <RecoverDialog credit={c} onClose={() => setModal(null)} /> : null}
    </Screen>
  );
}

function MovementRow({ movement: m }: { movement: SupplierCreditMovement }) {
  const { permissions } = useSession();
  const toast = useToast();
  const reverse = useReverseCreditMovement();
  const [open, setOpen] = useState(false);
  const reversed = m.status === 'reversed';
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{`${formatCents(m.amountCents)} em ${formatIsoDate(m.date)}`}</Text>
        <Text variant="small" color={color.textSecondary}>
          {m.type === 'applied'
            ? `Usado em ${m.payableDescription ?? 'título'}`
            : 'Devolvido pelo fornecedor'}
        </Text>
        {m.reversalReason ? (
          <Text variant="small" color={color.textSecondary}>
            {`Estornado: ${m.reversalReason}`}
          </Text>
        ) : null}
      </View>
      {reversed ? (
        <Badge label="Estornado" tone="neutral" />
      ) : permissions.includes('payables:reverse') ? (
        <Button
          label="Estornar"
          icon={Undo2}
          size="sm"
          variant="ghost"
          onPress={() => setOpen(true)}
        />
      ) : null}
      <ReasonDialog
        visible={open}
        title="Estornar movimentação?"
        description={
          m.type === 'applied'
            ? 'O valor volta para o crédito e o título volta a ter saldo.'
            : 'O valor volta para o crédito e sai do caixa realizado.'
        }
        confirmLabel="Estornar"
        loading={reverse.isPending}
        error={reverse.error}
        onClose={() => setOpen(false)}
        onConfirm={(reason) =>
          reverse.mutate(
            { id: m.id, reason },
            {
              onSuccess: () => {
                toast.show('Movimentação estornada');
                setOpen(false);
              },
            },
          )
        }
      />
    </View>
  );
}

function ApplyDialog({ credit: c, onClose }: { credit: SupplierCredit; onClose: () => void }) {
  const toast = useToast();
  const apply = useApplySupplierCredit(c.id);
  const { items } = usePayables({ situation: 'open', beneficiaryId: c.supplierId });
  const titles = items.filter((t) => t.origin === 'purchase');
  const [payableId, setPayableId] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const title = titles.find((t) => t.id === payableId);
  const limit = Math.min(c.balanceCents, title?.outstandingCents ?? 0);
  const valid = Boolean(title) && amountCents > 0 && amountCents <= limit;
  return (
    <Dialog
      visible
      title="Usar crédito em um título"
      description={`Saldo disponível: ${formatCents(c.balanceCents)}. O título é reduzido sem registrar saída de dinheiro.`}
      onClose={apply.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={apply.isPending} />
          <Button
            label="Usar crédito"
            variant="strong"
            loading={apply.isPending}
            disabled={!valid}
            onPress={() =>
              apply.mutate(
                { expectedVersion: c.version, payableId, amountCents },
                {
                  onSuccess: () => {
                    toast.show('Crédito usado');
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
        <CommandError error={apply.error} title="Crédito não usado" />
        {titles.length === 0 ? (
          <Text variant="body" color={color.textSecondary}>
            Este fornecedor não tem títulos de compra em aberto.
          </Text>
        ) : (
          <Select
            label="Título"
            placeholder="Escolha"
            value={payableId}
            options={titles.map((t) => ({
              value: t.id,
              label: `${t.description}, ${formatCents(t.outstandingCents)}`,
            }))}
            onChange={(value) => {
              setPayableId(value);
              const next = titles.find((t) => t.id === value);
              setAmountCents(Math.min(c.balanceCents, next?.outstandingCents ?? 0));
            }}
          />
        )}
        {title ? (
          <CurrencyInput label="Valor" value={amountCents} onChange={setAmountCents} />
        ) : null}
      </View>
    </Dialog>
  );
}

function RecoverDialog({ credit: c, onClose }: { credit: SupplierCredit; onClose: () => void }) {
  const toast = useToast();
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const recover = useRecoverSupplierCredit(c.id);
  const [amountCents, setAmountCents] = useState(c.balanceCents);
  const [recoveredOn, setRecoveredOn] = useState(today);
  const valid = amountCents > 0 && amountCents <= c.balanceCents;
  return (
    <Dialog
      visible
      title="Registrar devolução"
      description="Use quando o fornecedor devolver o dinheiro. O valor entra no caixa realizado."
      onClose={recover.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={recover.isPending} />
          <Button
            label="Registrar devolução"
            variant="strong"
            loading={recover.isPending}
            disabled={!valid}
            onPress={() =>
              recover.mutate(
                { expectedVersion: c.version, amountCents, recoveredOn },
                {
                  onSuccess: () => {
                    toast.show('Devolução registrada');
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
        <CommandError error={recover.error} title="Devolução não registrada" />
        <CurrencyInput label="Valor" value={amountCents} onChange={setAmountCents} />
        <DateField
          label="Data"
          value={recoveredOn}
          today={today}
          max={today}
          onChange={setRecoveredOn}
        />
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  stack: { gap: space[3] },
  compact: { gap: space[1] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  empty: { padding: space[4] },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
});
