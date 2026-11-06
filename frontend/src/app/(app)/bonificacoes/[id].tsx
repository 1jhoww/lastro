import { Fragment } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { BonusDetail } from '@/api/types';
import { useBonus } from '@/features/bonuses/api';
import { BonusReturnPanel } from '@/features/bonuses/BonusReturnPanel';
import {
  bonusStatusLabel,
  bonusStatusTone,
  eventLabel,
  kindLabel,
  reasonText,
  shortBonusId,
} from '@/features/bonuses/presentation';
import { DetailColumns, Fact } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { BonusDocuments } from '@/features/files/OrderDocuments';
import { shortOrderId } from '@/features/orders/rules';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { formatDateTime } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity, type Unit } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Badge, Button, Disclosure, Panel, Text } from '@/ui';

export default function BonusDetailScreen() {
  return (
    <RequirePermission anyOf={['bonuses:grant']} title="Bonificação">
      <BonusRecord />
    </RequirePermission>
  );
}

function BonusRecord() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bonus = useBonus(id);
  if (bonus.isPending) return <RecordLoading title="Bonificação" />;
  if (bonus.isError || !bonus.data)
    return (
      <RecordError
        title="Bonificação"
        error={bonus.error}
        backHref={'/bonificacoes' as Href}
        backLabel="Voltar para bonificações"
        onRetry={() => bonus.refetch()}
      />
    );
  return <BonusView bonus={bonus.data} onRefresh={() => bonus.refetch()} />;
}

const quantity = (text: string, unit: string) =>
  formatQuantity(fromApiQuantity(text), unit as Unit);

/** Data vem no rótulo; retorno mostra quanto voltou de cada produto. */
function eventText(event: BonusDetail['history'][number], lines: BonusDetail['lines']) {
  const title = event.reason
    ? `${eventLabel[event.type]}: ${event.reason}`
    : eventLabel[event.type];
  const returned = event.lines.flatMap((item) => {
    const line = lines.find((l) => l.id === item.lineId);
    return line
      ? [
          `${line.name}: ${quantity(item.sellable, line.unit)} vendável, ${quantity(item.damaged, line.unit)} danificado`,
        ]
      : [];
  });
  return [title, ...returned].join(' · ');
}

function BonusView({ bonus: b, onRefresh }: { bonus: BonusDetail; onRefresh: () => void }) {
  const { permissions } = useSession();
  const costs = new Map(b.cost?.lines.map((l) => [l.lineId, l.costCents]));
  return (
    <Screen title={shortBonusId(b.commercialId)} description={b.customerName ?? 'Sem cliente'}>
      <View style={styles.status}>
        <Badge label={bonusStatusLabel[b.status]} tone={bonusStatusTone[b.status]} />
        <Text variant="small" color={color.textSecondary}>
          {`${kindLabel[b.kind]} · Sem cobrança`}
        </Text>
      </View>
      {b.status === 'confirmed' ? (
        <Alert tone="info" title="Estoque reservado">
          Os itens saem do estoque na expedição do pedido. Cancelar o pedido libera a reserva.
        </Alert>
      ) : null}
      {b.kind === 'standalone' && !permissions.includes('returns:manage') ? (
        <Alert tone="info" title="Sem cancelamento">
          Bonificação registrada não pode ser cancelada nem editada. Para corrigir, peça ao
          administrador um retorno total.
        </Alert>
      ) : null}
      {b.orderId ? (
        <Link href={`/pedidos/${b.orderId}` as Href} asChild>
          <Button label="Abrir pedido vinculado" variant="outline" />
        </Link>
      ) : null}

      <DetailColumns
        main={
          <>
            <Panel title={`Produtos (${b.lines.length})`}>
              <View accessibilityRole="list" style={styles.lines}>
                {b.lines.map((l) => {
                  const returned = l.returnedSellable !== '0' || l.returnedDamaged !== '0';
                  const cost = costs.get(l.id);
                  return (
                    <View key={l.id} style={styles.line}>
                      <View style={styles.flex}>
                        <Text variant="bodyStrong" numberOfLines={2}>
                          {l.name}
                        </Text>
                        <Text variant="small" color={color.textSecondary}>
                          {l.sku}
                        </Text>
                        {returned ? (
                          <Text variant="small" color={color.textSecondary}>
                            {`Retornou: ${quantity(l.returnedSellable, l.unit)} vendável · ${quantity(l.returnedDamaged, l.unit)} danificado`}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.values}>
                        <Text variant="small">{quantity(l.quantity, l.unit)}</Text>
                        {b.cost ? (
                          <Text variant="caption" color={color.textSecondary}>
                            {cost == null ? 'Sem custo' : formatCents(cost)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Panel>
            {b.notes ? (
              <Panel title="Observações">
                <Text variant="body" selectable>
                  {b.notes}
                </Text>
              </Panel>
            ) : null}
            {b.status === 'dispatched' && permissions.includes('returns:manage') ? (
              <BonusReturnPanel bonus={b} onDone={onRefresh} />
            ) : null}
          </>
        }
        side={
          <>
            <Panel title="Registro">
              <View style={styles.facts}>
                <Fact label="Cliente" value={b.customerName ?? 'Sem cliente'} />
                <Fact label="Responsável" value={b.responsibleName ?? 'Usuário sem nome'} />
                <Fact
                  label="Data"
                  value={b.occurredAt ? formatDateTime(b.occurredAt) : 'Ainda em rascunho'}
                />
                <Fact label="Motivo" value={reasonText(b)} />
                {b.orderCommercialId ? (
                  <Fact label="Pedido" value={shortOrderId(b.orderCommercialId)} />
                ) : null}
                <Disclosure label="Identificação">
                  <Fact label="Número completo" value={b.commercialId} />
                </Disclosure>
              </View>
            </Panel>
            {b.cost ? (
              <Panel title="Custo das unidades">
                <View style={styles.facts}>
                  <Fact label="Custo na origem" value={formatCents(b.cost.grossCents)} />
                  <Fact label="Custo após retornos" value={formatCents(b.cost.netCents)} />
                  {b.cost.missingLines ? (
                    <Text variant="caption" color={color.textSecondary}>
                      Há produtos sem custo registrado, fora destes valores.
                    </Text>
                  ) : null}
                </View>
              </Panel>
            ) : null}
            <Disclosure label="Histórico">
              <View style={styles.facts}>
                {b.history.map((event) => (
                  <Fragment key={event.id}>
                    <Fact
                      label={formatDateTime(event.occurredAt)}
                      value={eventText(event, b.lines)}
                    />
                  </Fragment>
                ))}
              </View>
            </Disclosure>
            <BonusDocuments
              id={b.id}
              number={shortBonusId(b.commercialId)}
              version={b.version}
              status={b.status}
            />
          </>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[3] },
  lines: { gap: space[3] },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  values: { alignItems: 'flex-end', gap: 2 },
  facts: { gap: space[3] },
  flex: { flex: 1, minWidth: 0 },
});
