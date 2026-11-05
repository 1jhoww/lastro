import { useState } from 'react';
import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { InventoryItem, Purchase, SupplierOption } from '@/api/types';
import { FieldRow, FormActions, FormBody, FormGroup } from '@/features/catalog/FormParts';
import { ProductPicker } from '@/features/inventory/ProductPicker';
import { useConditionOptions } from '@/features/orders/api';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { formatCents } from '@/lib/money';
import { fromApiQuantity, toApiQuantity, type Unit } from '@/lib/quantity';
import { color, space, useLayoutSize } from '@/theme';
import {
  Button,
  CurrencyInput,
  DateField,
  IconButton,
  Panel,
  QuantityInput,
  Select,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Plus, Trash } from '@/ui/icons';
import { useCostSuggestion, useCreatePurchase, useUpdatePurchase } from './api';
import { CommandError, SummaryRow } from './Parts';
import { SupplierPicker } from './SupplierPicker';
import { draftTotals, lineSubtotal } from './presentation';

type Line = {
  productId: string;
  name: string;
  sku: string;
  unit: Unit;
  milli: number;
  unitCostCents: number;
  discountCents: number;
  suggested: number | null;
};
const fromPurchase = (p: Purchase): Line[] =>
  p.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku,
    unit: l.unit,
    milli: fromApiQuantity(l.quantity),
    unitCostCents: l.unitCostCents,
    discountCents: l.discountCents,
    suggested: l.suggestedUnitCostCents,
  }));

/**
 * Pedido de compra com quantos produtos forem necessários, no mesmo espírito do pedido de venda.
 * O custo sugerido entra pronto para editar. Salvar não mexe no estoque nem no financeiro: isso
 * acontece ao confirmar e ao receber.
 */
export function PurchaseEditor({ purchase }: { purchase?: Purchase }) {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const compact = useLayoutSize() === 'compact';
  const toast = useToast();
  const conditions = useConditionOptions();
  const suggestion = useCostSuggestion();
  const create = useCreatePurchase();
  const update = useUpdatePurchase(purchase?.id ?? '');
  const [supplier, setSupplier] = useState<Pick<SupplierOption, 'id' | 'name'> | null>(
    purchase?.supplierId
      ? { id: purchase.supplierId, name: purchase.supplierName ?? 'Fornecedor' }
      : null,
  );
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchaseDate ?? '');
  const [delivery, setDelivery] = useState(purchase?.expectedDeliveryDate ?? '');
  const [conditionId, setConditionId] = useState<string>(purchase?.paymentCondition?.id ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(purchase ? fromPurchase(purchase) : []);
  const [freightCents, setFreight] = useState(purchase?.freightCents ?? 0);
  const [otherCostsCents, setOther] = useState(purchase?.otherCostsCents ?? 0);
  const [discountCents, setDiscount] = useState(purchase?.discountCents ?? 0);
  const [pickingProduct, setPickingProduct] = useState(false);
  const [pickingSupplier, setPickingSupplier] = useState(false);
  const pending = create.isPending || update.isPending;
  const extras = { freightCents, otherCostsCents, discountCents };
  const totals = draftTotals(lines, extras);
  const options = conditions.data ?? [];
  const condition = options.find((c) => c.id === conditionId);
  const change = (productId: string, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  const addProduct = async (item: InventoryItem) => {
    setPickingProduct(false);
    if (lines.some((l) => l.productId === item.productId)) return;
    const suggested = await suggestion(item.productId)
      .then((s) => s.suggestedUnitCostCents)
      .catch(() => null);
    setLines((all) => [
      ...all,
      {
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        milli: 1000,
        unitCostCents: suggested ?? 0,
        discountCents: 0,
        suggested,
      },
    ]);
  };
  const body = {
    supplierId: supplier?.id ?? null,
    ...(purchaseDate ? { purchaseDate } : {}),
    expectedDeliveryDate: delivery || null,
    paymentConditionId: condition?.id ?? null,
    ...(condition ? { paymentConditionVersion: condition.version } : {}),
    notes: notes.trim(),
    lines: lines
      .filter((l) => l.milli > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: toApiQuantity(l.milli),
        unitCostCents: l.unitCostCents,
        ...(l.discountCents ? { discountCents: l.discountCents } : {}),
      })),
    ...extras,
  };
  const save = () => {
    if (pending) return;
    const done = (saved: Purchase) => {
      toast.show('Rascunho salvo');
      router.replace(`/compras/${saved.id}` as Href);
    };
    if (purchase)
      update.mutate({ ...body, expectedVersion: purchase.version }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };

  return (
    <FormBody>
      <CommandError error={create.error ?? update.error} title="Compra não salva" />
      <FormGroup title="Dados da compra">
        <FieldRow weights={[3, 2, 2]}>
          <View style={styles.supplier}>
            <Text variant="smallStrong">Fornecedor</Text>
            <Button
              label={supplier ? supplier.name : 'Escolher fornecedor'}
              variant="outline"
              onPress={() => setPickingSupplier(true)}
              fullWidth
            />
          </View>
          <DateField
            label="Data da compra"
            value={purchaseDate || today}
            today={today}
            onChange={setPurchaseDate}
          />
          <DateField
            label="Previsão de entrega"
            value={delivery}
            today={today}
            onChange={setDelivery}
            optional
          />
        </FieldRow>
        <FieldRow weights={[1, 1]}>
          <Select
            label="Condição de pagamento"
            value={conditionId || null}
            options={options.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setConditionId}
            placeholder={conditions.isPending ? 'Carregando' : 'Escolha'}
            hint="As mesmas condições usadas nos pedidos."
          />
          <TextField
            label="Observações"
            value={notes}
            onChangeText={setNotes}
            maxLength={1000}
            optional
          />
        </FieldRow>
      </FormGroup>

      <FormGroup
        title="Produtos"
        aside={
          <Button
            label="Adicionar produto"
            icon={Plus}
            size="sm"
            variant="outline"
            onPress={() => setPickingProduct(true)}
          />
        }
      >
        {lines.length === 0 ? (
          <Text variant="body" color={color.textSecondary}>
            Busque pelo nome ou SKU e inclua todos os produtos desta compra no mesmo pedido.
          </Text>
        ) : (
          <View style={styles.lines}>
            {lines.map((line) => (
              <Panel key={line.productId}>
                <View style={styles.line}>
                  <View style={styles.lineHead}>
                    <View style={styles.flex}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {line.name}
                      </Text>
                      <Text variant="small" color={color.textSecondary}>
                        {line.sku}
                      </Text>
                    </View>
                    <IconButton
                      icon={Trash}
                      label={`Retirar ${line.name}`}
                      onPress={() =>
                        setLines((all) => all.filter((l) => l.productId !== line.productId))
                      }
                    />
                  </View>
                  <FieldRow weights={[2, 2, 2, 2]}>
                    <View style={styles.quantity}>
                      <Text variant="smallStrong">Quantidade</Text>
                      <QuantityInput
                        label={`Quantidade de ${line.name}`}
                        value={line.milli}
                        unit={line.unit}
                        min={0}
                        onChange={(milli) => change(line.productId, { milli })}
                      />
                    </View>
                    <CurrencyInput
                      label="Custo unitário"
                      value={line.unitCostCents}
                      onChange={(unitCostCents) => change(line.productId, { unitCostCents })}
                      hint={
                        line.suggested !== null
                          ? `Sugerido: ${formatCents(line.suggested)}`
                          : 'Sem custo de referência'
                      }
                    />
                    <CurrencyInput
                      label="Desconto do item"
                      value={line.discountCents}
                      onChange={(value) => change(line.productId, { discountCents: value })}
                      optional
                    />
                    <View style={styles.subtotal}>
                      <Text variant="small" color={color.textSecondary}>
                        Subtotal
                      </Text>
                      <Text variant="figure">
                        {formatCents(lineSubtotal(line) - line.discountCents)}
                      </Text>
                    </View>
                  </FieldRow>
                </View>
              </Panel>
            ))}
          </View>
        )}
      </FormGroup>

      <FormGroup
        title="Valores adicionais"
        description="Frete e despesas entram no custo dos produtos, na proporção do valor de cada item. Não lance de novo como despesa."
      >
        <FieldRow weights={[1, 1, 1]}>
          <CurrencyInput label="Frete" value={freightCents} onChange={setFreight} optional />
          <CurrencyInput
            label="Despesas adicionais"
            value={otherCostsCents}
            onChange={setOther}
            optional
          />
          <CurrencyInput
            label="Desconto da compra"
            value={discountCents}
            onChange={setDiscount}
            optional
          />
        </FieldRow>
        <View style={[styles.totals, !compact && styles.totalsWide]}>
          <SummaryRow label="Produtos" value={formatCents(totals.subtotalCents)} />
          {totals.lineDiscountCents ? (
            <SummaryRow
              label="Descontos dos itens"
              value={formatCents(-totals.lineDiscountCents)}
            />
          ) : null}
          <SummaryRow label="Total da compra" value={formatCents(totals.totalCents)} strong />
        </View>
      </FormGroup>

      <FormActions>
        <Button label="Cancelar" variant="ghost" onPress={() => router.back()} disabled={pending} />
        <Button label="Salvar rascunho" variant="strong" loading={pending} onPress={save} />
      </FormActions>

      <SupplierPicker
        visible={pickingSupplier}
        onClose={() => setPickingSupplier(false)}
        onPick={(s) => {
          setSupplier(s);
          setPickingSupplier(false);
        }}
      />
      <ProductPicker
        visible={pickingProduct}
        onClose={() => setPickingProduct(false)}
        onPick={(item) => void addProduct(item)}
      />
    </FormBody>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  supplier: { gap: space[2] },
  lines: { gap: space[3] },
  line: { gap: space[3] },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  quantity: { gap: space[2] },
  subtotal: { gap: space[1], alignItems: 'flex-end', justifyContent: 'center', minHeight: 44 },
  totals: { gap: space[2], paddingTop: space[2] },
  totalsWide: { alignSelf: 'flex-end', minWidth: 320 },
});
