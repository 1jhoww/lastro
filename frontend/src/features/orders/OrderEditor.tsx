import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, router, type Href } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { toApiError, type ApiError } from '@/api/errors';
import type { Order, OrderCreate, OrderUpdate, Product } from '@/api/types';
import { FieldRow } from '@/features/catalog/FormParts';
import { useAvailability } from '@/features/inventory/api';
import { useTenant } from '@/features/session/useTenant';
import { memberLabel, shortId, useMembers } from '@/features/users/api';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, Dialog, EmptyState, Select, Text, TextField, useToast } from '@/ui';
import { Package } from '@/ui/icons';
import { useConditionOptions, useCreateOrder, useMethodOptions, useUpdateOrder } from './api';
import { CartList } from './CartList';
import { CustomerCombobox, type PickedCustomer } from './CustomerCombobox';
import { PaymentFields } from './PaymentFields';
import { paymentPreview } from './paymentPreview';
import { ProductSearch } from './ProductSearch';
import {
  cartFromOrder,
  cartTotalPreview,
  paymentBody,
  paymentChoiceOf,
  toLinesInput,
  todayIn,
  type CartLine,
  type PaymentChoice,
} from './rules';

/** Mensagens de recusa ao salvar o rascunho, pelo código estável do servidor. */
export function saveErrorMessage(e: ApiError): string {
  switch (e.code) {
    case 'CONFLICT':
      return 'O rascunho foi alterado por outra pessoa ou não é mais um rascunho. Nada foi salvo: carregue a versão atual e refaça a alteração.';
    case 'PRODUCT_UNAVAILABLE':
      return 'Um dos produtos foi desativado ou mudou de unidade. Remova-o do carrinho e salve de novo.';
    case 'CUSTOMER_INACTIVE':
      return 'O cliente foi desativado. Escolha outro cliente.';
    case 'INVALID_DUE_DATE':
      return 'Os vencimentos precisam ser de hoje em diante e em ordem.';
    case 'INVALID_PAYMENT_SELECTION':
      return 'Escolha uma condição cadastrada ou vencimentos manuais, não os dois.';
    case 'RESOURCE_NOT_FOUND':
      return 'Cliente, produto ou condição não encontrado. Recarregue e escolha de novo.';
    case 'INVALID_RESPONSIBLE':
      return 'O responsável escolhido não tem vínculo ativo na empresa.';
    default:
      return e.userMessage;
  }
}

const itemsLabel = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/** Título discreto de seção, sem cartão em volta. */
function Section({
  title,
  aside,
  children,
  style,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <Text variant="h3" accessibilityRole="header">
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

/**
 * Pedido em uma página contínua: dados, produtos, pagamento e finalização, todos editáveis a
 * qualquer momento. Novo pedido: o rascunho só é criado ao salvar (POST sem Idempotency-Key,
 * nunca repetido sozinho). Rascunho existente: salva com `expectedVersion`. "Confirmar pedido"
 * salva e abre a confirmação (reserva de estoque) na ficha, com o resumo oficial do servidor.
 * Preços e totais aqui são prévia; os valores oficiais são os do servidor após salvar.
 */
export function OrderEditor({
  order: current,
  onReload,
  title,
  description,
}: {
  order?: Order;
  /** Recarrega o editor a partir da versão atual do servidor (após conflito). */
  onReload?: () => void;
  title: string;
  description?: string;
}) {
  // Versão base fixada ao abrir: salvar nunca sobrescreve uma versão que a pessoa não viu.
  const [order] = useState(current);
  const { user, permissions } = useSession();
  const tenant = useTenant();
  const toast = useToast();
  const size = useLayoutSize();
  const compact = size === 'compact';
  const wide = size === 'expanded';
  const admin = permissions.includes('orders:all:manage');
  const canConfirm = permissions.includes('orders:own:confirm');
  const today = todayIn(tenant.data?.timezone);

  const [customer, setCustomer] = useState<PickedCustomer | null>(
    order?.customerId ? { id: order.customerId, name: order.customerName ?? 'Cliente' } : null,
  );
  const [sellerUid, setSellerUid] = useState(order?.sellerUid ?? user?.uid ?? '');
  const [lines, setLines] = useState<CartLine[]>(() => (order ? cartFromOrder(order) : []));
  const [payment, setPayment] = useState<PaymentChoice>(() => paymentChoiceOf(order));
  const [methodId, setMethodId] = useState<string | null>(order?.intendedPaymentMethod?.id ?? null);
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [paymentError, setPaymentError] = useState<string>();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const conditions = useConditionOptions();
  const methods = useMethodOptions();
  const members = useMembers(admin);
  const create = useCreateOrder();
  const update = useUpdateOrder(order?.id ?? '');
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  const productIds = useMemo(() => lines.map((l) => l.productId), [lines]);
  const available = useAvailability(productIds);
  const quantities = useMemo(
    () => new Map(lines.map((l) => [l.productId, l.quantityMilli])),
    [lines],
  );
  const total = cartTotalPreview(lines);
  const preview = paymentPreview(total, payment, conditions.data ?? [], today);

  /** Catálogo: zero retira do carrinho; acima de zero inclui ou ajusta. */
  const setProductQuantity = useCallback((p: Product, milli: number) => {
    setLines((current) => {
      if (milli <= 0) return current.filter((l) => l.productId !== p.id);
      if (current.some((l) => l.productId === p.id))
        return current.map((l) => (l.productId === p.id ? { ...l, quantityMilli: milli } : l));
      return [
        ...current,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          unitPriceCents: p.priceCents,
          quantityMilli: milli,
        },
      ];
    });
  }, []);
  const setQuantity = useCallback((productId: string, milli: number) => {
    setLines((current) =>
      current.map((l) => (l.productId === productId ? { ...l, quantityMilli: milli } : l)),
    );
  }, []);
  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((l) => l.productId !== productId));
  }, []);

  const save = (then: 'view' | 'confirm') => {
    const pay = paymentBody(
      payment,
      conditions.data ?? [],
      methods.data?.find((m) => m.id === methodId) ?? null,
      today,
    );
    if (!pay.ok) {
      setPaymentError(pay.reason);
      return;
    }
    setPaymentError(undefined);
    const common = {
      customerId: customer?.id ?? null,
      lines: toLinesInput(lines),
      notes: notes.trim(),
      ...pay.body,
      // Só administrador escolhe o responsável; o vendedor nunca envia este campo.
      ...(admin && sellerUid && sellerUid !== (order?.sellerUid ?? user?.uid) ? { sellerUid } : {}),
    };
    const onSuccess = (saved: Order) => {
      setSummaryOpen(false);
      if (then === 'confirm') {
        toast.show('Rascunho salvo. Revise e confirme a reserva.');
        router.replace(`/pedidos/${saved.id}?confirmar=1` as Href);
      } else {
        toast.show(order ? 'Rascunho salvo!' : 'Rascunho criado!');
        router.replace(`/pedidos/${saved.id}` as Href);
      }
    };
    if (order)
      update.mutate({ ...common, expectedVersion: order.version } as OrderUpdate, { onSuccess });
    else {
      // Na criação, `payment: null` e IDs nulos são equivalentes a não informar.
      const body = Object.fromEntries(
        Object.entries(common).filter(([, v]) => v !== null),
      ) as OrderCreate;
      create.mutate(body, { onSuccess });
    }
  };

  const createUnknown =
    !order && create.isError && ['network', 'server'].includes(toApiError(create.error).kind);
  const incomplete = !customer || lines.length === 0;
  const blocked = incomplete || createUnknown;

  const responsibleOptions =
    admin && members.data
      ? members.data
          .filter((m) => m.status === 'active' || m.id === sellerUid)
          .map((m) => ({
            value: m.id,
            label: m.id === user?.uid ? 'Você' : memberLabel(m),
          }))
      : [
          {
            value: sellerUid,
            label: sellerUid === user?.uid ? 'Você' : `Vendedor ${shortId(sellerUid)}`,
          },
        ];

  const cart =
    lines.length === 0 ? (
      <EmptyState
        size="compact"
        icon={Package}
        title="Carrinho vazio"
        description="Ajuste a quantidade de um produto para incluí-lo."
      />
    ) : (
      <CartList
        lines={lines}
        available={available}
        onQuantity={setQuantity}
        onRemove={remove}
        disabled={saving}
        dense={wide}
      />
    );

  const totalLine = (
    <View style={styles.totalLine}>
      <Text variant="body" color={color.textSecondary}>
        Total previsto
      </Text>
      <Text variant="figureLarge" accessibilityLabel={`Total previsto ${formatCents(total)}`}>
        {formatCents(total)}
      </Text>
    </View>
  );

  const paymentLabel =
    payment.mode === 'later'
      ? 'Definir depois'
      : payment.mode === 'manual'
        ? payment.type === 'cash'
          ? 'À vista'
          : `${payment.count} parcelas`
        : (conditions.data?.find((c) => c.id === payment.conditionId)?.name ?? 'Condição');

  const confirmHint = !canConfirm
    ? null
    : payment.mode === 'later'
      ? 'Para confirmar, escolha a condição de pagamento.'
      : null;

  const footerActions = (
    <View style={[styles.actions, compact && styles.actionsCompact]}>
      <Button
        label="Salvar rascunho"
        variant="outline"
        loading={saving}
        disabled={blocked}
        fullWidth={compact}
        onPress={() => save('view')}
      />
      {canConfirm ? (
        <Button
          label="Confirmar pedido"
          variant="strong"
          disabled={blocked || saving || payment.mode === 'later'}
          fullWidth={compact}
          onPress={() => save('confirm')}
        />
      ) : null}
    </View>
  );

  const mobileBar = compact ? (
    <View style={styles.bar}>
      <View style={styles.flex}>
        <Text variant="caption" color={color.textSecondary}>
          {itemsLabel(lines.length)}
        </Text>
        <Text variant="figure" accessibilityLabel={`Total previsto ${formatCents(total)}`}>
          {formatCents(total)}
        </Text>
      </View>
      <Button
        label="Ver resumo"
        size="sm"
        variant="outline"
        icon={Package}
        onPress={() => setSummaryOpen(true)}
      />
    </View>
  ) : undefined;

  return (
    <Screen title={title} description={description} footer={mobileBar}>
      <View style={styles.form}>
        <Section title="Dados do pedido" style={styles.raised}>
          <FieldRow weights={[65, 35]}>
            {[
              <CustomerCombobox
                key="customer"
                value={customer}
                onChange={setCustomer}
                disabled={saving}
              />,
              <Select
                key="seller"
                label="Responsável"
                value={sellerUid}
                onChange={setSellerUid}
                disabled={!admin || !members.data || saving}
                options={responsibleOptions}
              />,
            ]}
          </FieldRow>
        </Section>

        <View style={[styles.columns, wide && styles.columnsWide]}>
          <View style={[styles.main, wide && styles.grow]}>
            <Section title="Produtos">
              <ProductSearch quantities={quantities} onQuantity={setProductQuantity} />
              {wide ? null : (
                <View style={styles.inlineCart}>
                  <Text variant="smallStrong">{`Carrinho · ${itemsLabel(lines.length)}`}</Text>
                  {cart}
                  {totalLine}
                </View>
              )}
            </Section>

            <Section title="Pagamento">
              {conditions.isError ? (
                <Alert tone="danger" title="Condições indisponíveis">
                  {toApiError(conditions.error).userMessage}
                </Alert>
              ) : null}
              {methods.isError ? (
                <Alert
                  tone="danger"
                  title="Formas indisponíveis"
                  action={<Button label="Recarregar formas" onPress={() => methods.refetch()} />}
                >
                  {toApiError(methods.error).userMessage}
                </Alert>
              ) : null}
              <PaymentFields
                choice={payment}
                onChange={setPayment}
                conditions={conditions.data ?? []}
                methods={methods.data ?? []}
                methodId={methodId}
                onMethod={setMethodId}
                preview={preview}
                today={today}
                error={paymentError}
                disabled={saving}
              />
            </Section>

            <Section title="Finalização">
              <TextField
                label="Observações"
                optional
                multiline
                maxLength={1000}
                value={notes}
                onChangeText={setNotes}
                placeholder="Instruções de entrega, combinados com o cliente…"
                style={styles.notes}
              />
              <View style={styles.summary} accessibilityLabel="Resumo financeiro">
                <SummaryLine label="Cliente" value={customer?.name ?? 'Não escolhido'} />
                <SummaryLine label="Itens" value={itemsLabel(lines.length)} />
                <SummaryLine
                  label="Pagamento"
                  value={preview.length > 1 ? `${paymentLabel} · ${preview.length}x` : paymentLabel}
                />
              </View>

              {createUnknown ? (
                <Alert
                  tone="warning"
                  title="Não sabemos se o rascunho foi criado"
                  action={
                    <Link href={'/pedidos?situacao=draft' as Href} asChild>
                      <Button label="Ver rascunhos" size="sm" variant="outline" />
                    </Link>
                  }
                >
                  A conexão falhou antes da resposta. Confira a lista de rascunhos antes de salvar
                  de novo: a criação não tem proteção contra duplicidade no servidor.
                </Alert>
              ) : saveError ? (
                <Alert
                  tone={toApiError(saveError).code === 'CONFLICT' ? 'warning' : 'danger'}
                  title="Rascunho não salvo"
                  action={
                    toApiError(saveError).code === 'CONFLICT' && onReload ? (
                      <Button
                        label="Carregar versão atual"
                        size="sm"
                        variant="outline"
                        onPress={onReload}
                      />
                    ) : null
                  }
                >
                  {saveErrorMessage(toApiError(saveError))}
                </Alert>
              ) : null}

              <View style={[styles.footer, compact && styles.footerCompact]}>
                <View>
                  <Text variant="small" color={color.textSecondary}>
                    Total do pedido
                  </Text>
                  <Text variant="figureLarge">{formatCents(total)}</Text>
                </View>
                {footerActions}
              </View>
              {incomplete ? (
                <Text
                  variant="caption"
                  color={color.textSecondary}
                  align={compact ? 'left' : 'right'}
                >
                  Escolha o cliente e inclua ao menos um produto para salvar.
                </Text>
              ) : confirmHint ? (
                <Text
                  variant="caption"
                  color={color.textSecondary}
                  align={compact ? 'left' : 'right'}
                >
                  {confirmHint}
                </Text>
              ) : null}
            </Section>
          </View>

          {wide ? (
            <View style={[styles.aside, sticky]}>
              <View style={styles.sectionHead}>
                <Text variant="h3" accessibilityRole="header">
                  Carrinho
                </Text>
                <Text variant="small" color={color.textSecondary}>
                  {itemsLabel(lines.length)}
                </Text>
              </View>
              <ScrollView style={asideScroll}>{cart}</ScrollView>
              {totalLine}
            </View>
          ) : null}
        </View>
      </View>

      <Dialog
        visible={summaryOpen}
        title={`Carrinho · ${itemsLabel(lines.length)}`}
        onClose={() => setSummaryOpen(false)}
        actions={<Button label="Fechar" variant="ghost" onPress={() => setSummaryOpen(false)} />}
      >
        {cart}
        {totalLine}
      </Dialog>
    </Screen>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text variant="smallStrong" numberOfLines={1} style={styles.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

// Web: resumo lateral acompanha a rolagem; a lista rola sozinha quando passa da altura da tela.
const sticky = (Platform.OS === 'web' ? { position: 'sticky', top: space[6] } : {}) as ViewStyle;
const asideScroll = (
  Platform.OS === 'web' ? { maxHeight: 'calc(100vh - 220px)' } : {}
) as ViewStyle;

const styles = StyleSheet.create({
  form: { gap: space[8] },
  section: { gap: space[4] },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[3],
    paddingBottom: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  // Lista de clientes flutua sobre as seções seguintes.
  raised: { zIndex: 20 },
  columns: { gap: space[8] },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { minWidth: 0, gap: space[8] },
  grow: { flex: 1 },
  aside: {
    width: 380,
    gap: space[3],
    padding: space[4],
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 14,
    backgroundColor: color.surface,
  },
  inlineCart: { gap: space[2], paddingTop: space[2] },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  notes: { minHeight: 56, textAlignVertical: 'top' },
  summary: { gap: space[1] },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
  summaryValue: { flexShrink: 1, textAlign: 'right' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    paddingTop: space[4],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  footerCompact: { flexDirection: 'column', alignItems: 'stretch' },
  actions: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  actionsCompact: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
});
