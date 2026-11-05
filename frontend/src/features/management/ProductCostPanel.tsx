import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Button, CurrencyInput, Dialog, Panel, Skeleton, Text, useToast } from '@/ui';
import { useCostHistory, useProductCosts, useUpdateReferenceCost } from './api';
import { CommandError, Stack, SummaryRow } from './Parts';
import { costEventCopy, formatMargin } from './presentation';

const money = (cents: number | null) => (cents === null ? 'Sem registro' : formatCents(cents));

/** Custos e margem do produto. Só existe para quem tem permissão; preço de venda nunca muda aqui. */
export function ProductCostPanel({ productId }: { productId: string }) {
  const { permissions } = useSession();
  const costs = useProductCosts(productId);
  const history = useCostHistory(productId);
  const [editing, setEditing] = useState(false);
  const data = costs.data;
  return (
    <Panel
      title="Custos e margem"
      description="Estimativa com o custo atual. Vendas passadas mantêm o custo da época."
      action={
        permissions.includes('products:manage') && data ? (
          <Button
            label="Alterar custo"
            size="sm"
            variant="outline"
            onPress={() => setEditing(true)}
          />
        ) : undefined
      }
    >
      {costs.isPending ? (
        <Skeleton width="70%" height={64} />
      ) : data ? (
        <Stack>
          <SummaryRow label="Custo de referência" value={money(data.referenceCostCents)} />
          <SummaryRow label="Custo médio ponderado" value={money(data.averageCostCents)} />
          <SummaryRow label="Último custo de compra" value={money(data.lastPurchaseCostCents)} />
          <SummaryRow label="Preço de venda" value={formatCents(data.priceCents)} />
          <SummaryRow
            label="Lucro bruto por unidade"
            value={
              data.unitGrossProfitCents === null ? '—' : formatCents(data.unitGrossProfitCents)
            }
          />
          <SummaryRow label="Margem bruta" value={formatMargin(data.grossMarginBp)} strong />
          {history.items.length ? (
            <View style={styles.history}>
              <Text variant="smallStrong">Histórico de custos</Text>
              {history.items.map((event) => (
                <View key={event.id} style={styles.event}>
                  <Text variant="small" style={styles.flex} numberOfLines={1}>
                    {costEventCopy[event.type] ?? event.type}
                  </Text>
                  <Text variant="small" color={color.textSecondary}>
                    {`${event.averageCostCents === null ? '' : `${formatCents(event.averageCostCents)}, `}${formatDateTime(event.occurredAt)}`}
                  </Text>
                </View>
              ))}
              {history.query.hasNextPage ? (
                <Button
                  label="Carregar mais"
                  size="sm"
                  variant="ghost"
                  loading={history.query.isFetchingNextPage}
                  onPress={() => history.query.fetchNextPage()}
                />
              ) : null}
            </View>
          ) : null}
        </Stack>
      ) : null}
      {editing && data ? (
        <ReferenceDialog
          productId={productId}
          version={data.version}
          initial={data.referenceCostCents}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Panel>
  );
}

function ReferenceDialog({
  productId,
  version,
  initial,
  onClose,
}: {
  productId: string;
  version: number;
  initial: number | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const update = useUpdateReferenceCost(productId);
  const [cents, setCents] = useState(initial ?? 0);
  return (
    <Dialog
      visible
      title="Custo de referência"
      description="É o custo sugerido nas próximas compras. Não altera o preço de venda nem o custo médio."
      onClose={update.isPending ? () => {} : onClose}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onClose} disabled={update.isPending} />
          <Button
            label="Salvar custo"
            variant="strong"
            loading={update.isPending}
            onPress={() =>
              update.mutate(
                { expectedVersion: version, referenceCostCents: cents },
                {
                  onSuccess: () => {
                    toast.show('Custo salvo');
                    onClose();
                  },
                },
              )
            }
          />
        </>
      }
    >
      <Stack>
        <CommandError error={update.error} title="Custo não salvo" />
        <CurrencyInput label="Custo de referência" value={cents} onChange={setCents} />
      </Stack>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  history: { gap: space[2], paddingTop: space[2] },
  event: { flexDirection: 'row', gap: space[3] },
});
