import { useCallback, useMemo, useState } from 'react';
import { Link, router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError, type ApiError } from '@/api/errors';
import type { Customer, Order, OrderCreate, OrderUpdate, Product } from '@/api/types';
import { FormActions } from '@/features/catalog/FormParts';
import { useAvailability } from '@/features/inventory/api';
import { useTenant } from '@/features/session/useTenant';
import { shortId, useMembers } from '@/features/users/api';
import { formatCents } from '@/lib/money';
import { QUANTITY_SCALE } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Button,
  EmptyState,
  Disclosure,
  Panel,
  Segmented,
  Select,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Package, UserRound } from '@/ui/icons';
import { useConditionOptions, useCreateOrder, useMethodOptions, useUpdateOrder } from './api';
import { CartList } from './CartList';
import { CustomerPicker, CustomerSelection } from './CustomerPicker';
import { PaymentFields } from './PaymentFields';
import { paymentPreview } from './paymentPreview';
import { ProductSearch } from './ProductSearch';
import {
  cartFromOrder,
  formatCalendarDate,
  cartTotalPreview,
  paymentBody,
  paymentChoiceOf,
  toLinesInput,
  todayIn,
  type CartLine,
  type PaymentChoice,
} from './rules';

type Step = 'cliente' | 'produtos' | 'revisao';

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

/**
 * Montagem do pedido em três passos curtos. Novo pedido: o rascunho só é criado ao salvar (POST
 * sem Idempotency-Key, nunca repetido sozinho). Rascunho existente: salva com `expectedVersion`.
 * Preços e totais aqui são prévia; os valores oficiais são os do servidor após salvar.
 */
export function OrderEditor({
  order: current,
  onReload,
}: {
  order?: Order;
  /** Recarrega o editor a partir da versão atual do servidor (após conflito). */
  onReload?: () => void;
}) {
  // Versão base fixada ao abrir: salvar nunca sobrescreve uma versão que a pessoa não viu.
  const [order] = useState(current);
  const { user, permissions } = useSession();
  const tenant = useTenant();
  const toast = useToast();
  const compact = useLayoutSize() === 'compact';
  const wide = useLayoutSize() === 'expanded';
  const admin = permissions.includes('orders:all:manage');
  const today = todayIn(tenant.data?.timezone);

  const [step, setStep] = useState<Step>(order ? 'produtos' : 'cliente');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    order?.customerId ? { id: order.customerId, name: order.customerName ?? 'Cliente' } : null,
  );
  const [sellerUid, setSellerUid] = useState(order?.sellerUid ?? user?.uid ?? '');
  const [lines, setLines] = useState<CartLine[]>(() => (order ? cartFromOrder(order) : []));
  const [payment, setPayment] = useState<PaymentChoice>(() => paymentChoiceOf(order));
  const [methodId, setMethodId] = useState<string | null>(order?.intendedPaymentMethod?.id ?? null);
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [picking, setPicking] = useState(false);
  const [paymentError, setPaymentError] = useState<string>();

  const conditions = useConditionOptions(step === 'revisao');
  const methods = useMethodOptions(step === 'revisao');
  const members = useMembers(admin);
  const create = useCreateOrder();
  const update = useUpdateOrder(order?.id ?? '');
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  const productIds = useMemo(() => lines.map((l) => l.productId), [lines]);
  const available = useAvailability(productIds);
  const inCart = useMemo(() => new Set(productIds), [productIds]);
  const total = cartTotalPreview(lines);

  const add = useCallback((p: Product) => {
    setLines((current) =>
      current.some((l) => l.productId === p.id)
        ? current
        : [
            ...current,
            {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              unit: p.unit,
              unitPriceCents: p.priceCents,
              quantityMilli: QUANTITY_SCALE,
            },
          ],
    );
  }, []);
  const setQuantity = useCallback((productId: string, milli: number) => {
    setLines((current) =>
      current.map((l) => (l.productId === productId ? { ...l, quantityMilli: milli } : l)),
    );
  }, []);
  const remove = useCallback((productId: string) => {
    setLines((current) => current.filter((l) => l.productId !== productId));
  }, []);

  const save = () => {
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
      toast.show(order ? 'Rascunho salvo!' : 'Pedido criado!');
      router.replace(`/pedidos/${saved.id}` as Href);
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

  const steps: { value: Step; label: string }[] = [
    { value: 'cliente', label: '1 Cliente' },
    { value: 'produtos', label: `2 Produtos (${lines.length})` },
    { value: 'revisao', label: '3 Revisão' },
  ];

  const customerPanel = (
    <Panel
      title="Cliente"
      action={
        customer ? (
          <Button label="Trocar" size="sm" variant="outline" onPress={() => setPicking(true)} />
        ) : null
      }
    >
      {customer ? (
        <View style={styles.customer}>
          <UserRound size={20} color={color.textSecondary} />
          <Text variant="bodyStrong">{customer.name}</Text>
        </View>
      ) : (
        <CustomerSelection
          onPick={(c) => {
            setCustomer({ id: c.id, name: c.name });
            setStep('produtos');
          }}
        />
      )}
      {admin && members.data ? (
        <View style={styles.responsible}>
          <Select
            label="Responsável pelo pedido"
            value={sellerUid}
            onChange={setSellerUid}
            options={members.data
              .filter((m) => m.status === 'active')
              .map((m) => ({
                value: m.id,
                label:
                  m.id === user?.uid
                    ? 'Você'
                    : `${m.role === 'seller' ? 'Vendedor' : 'Administrador'} ${shortId(m.id)}`,
              }))}
          />
        </View>
      ) : null}
    </Panel>
  );

  const cartPanel = (
    <Panel
      title={`Carrinho (${lines.length} ${lines.length === 1 ? 'item' : 'itens'})`}
      description="Confira quantidades e valores antes de salvar."
    >
      {lines.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Package}
          title="Carrinho vazio"
          description="Busque e adicione produtos. Não há limite de itens por pedido."
        />
      ) : (
        <CartList
          lines={lines}
          available={available}
          onQuantity={setQuantity}
          onRemove={remove}
          disabled={saving}
        />
      )}
      <View style={styles.total}>
        <Text variant="body" color={color.textSecondary}>
          Total previsto
        </Text>
        <Text variant="figureLarge" accessibilityLabel={`Total previsto ${formatCents(total)}`}>
          {formatCents(total)}
        </Text>
      </View>
    </Panel>
  );

  return (
    <>
      <Segmented<Step> label="Passos do pedido" options={steps} value={step} onChange={setStep} />

      {step === 'cliente' ? (
        <>
          {customerPanel}
          <FormActions>
            <Button
              label="Continuar para produtos"
              variant="strong"
              disabled={!customer}
              onPress={() => setStep('produtos')}
            />
          </FormActions>
        </>
      ) : null}

      {step === 'produtos' ? (
        <>
          {customerPanel}
          <View style={[styles.columns, wide && styles.columnsWide]}>
            <View style={[styles.col, wide && { flex: 2 }]}>
              <Panel title="Produtos">
                <ProductSearch inCart={inCart} onAdd={add} />
              </Panel>
            </View>
            <View style={[styles.col, wide && { flex: 3 }]}>{cartPanel}</View>
          </View>
          <FormActions>
            <Button label="Voltar" variant="ghost" onPress={() => setStep('cliente')} />
            <Button
              label="Revisar pedido"
              variant="strong"
              disabled={lines.length === 0}
              onPress={() => setStep('revisao')}
            />
          </FormActions>
        </>
      ) : null}

      {step === 'revisao' ? (
        <>
          {customerPanel}
          <View style={[styles.columns, wide && styles.columnsWide]}>
            <View style={[styles.col, { flex: 1, minWidth: 0 }]}>
              <Disclosure
                label={`Revisar ${lines.length} itens`}
                summary={formatCents(total)}
                defaultOpen
              >
                {cartPanel}
              </Disclosure>
            </View>
            <View style={[styles.col, { flex: 1, minWidth: 0 }]}>
              <Panel title="Pagamento">
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
                  error={paymentError}
                  disabled={saving}
                />
                {paymentPreview(total, payment, conditions.data ?? [], today).map((p, i) => (
                  <View
                    key={i}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[2] }}
                  >
                    <Text variant="small">
                      {i + 1}ª · {formatCalendarDate(p.date)}
                    </Text>
                    <Text variant="smallStrong">{formatCents(p.amountCents)}</Text>
                  </View>
                ))}
                {payment.mode !== 'later' ? (
                  <Text variant="caption" color={color.textSecondary}>
                    Prévia de vencimentos e valores. Confira as parcelas registradas após salvar.
                  </Text>
                ) : null}
              </Panel>
              <Panel title="Observações">
                <TextField
                  label="Observações do pedido"
                  hideLabel
                  optional
                  multiline
                  maxLength={1000}
                  value={notes}
                  onChangeText={setNotes}
                  style={styles.notes}
                />
              </Panel>
            </View>
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
              A conexão falhou antes da resposta. Confira a lista de rascunhos antes de salvar de
              novo: a criação não tem proteção contra duplicidade no servidor.
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

          <FormActions>
            <Button
              label="Voltar"
              variant="ghost"
              disabled={saving}
              onPress={() => setStep('produtos')}
            />
            <Button
              label={order ? 'Salvar rascunho' : 'Criar rascunho'}
              variant="strong"
              loading={saving}
              disabled={!customer || lines.length === 0 || createUnknown}
              onPress={save}
            />
          </FormActions>
          <Text variant="caption" color={color.textSecondary} align={compact ? 'center' : 'right'}>
            A confirmação (com reserva de estoque) é feita na ficha do pedido, depois de salvar.
          </Text>
        </>
      ) : null}

      <CustomerPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(c: Customer) => {
          setCustomer({ id: c.id, name: c.name });
          setPicking(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  customer: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingTop: space[1] },
  responsible: { paddingTop: space[4] },
  columns: { gap: space[5] },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: space[5] },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: space[4],
    marginTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
});
