import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Charge } from '@/api/types';
import { formatCents } from '@/lib/money';
import { color, space, useLayoutSize } from '@/theme';
import { Badge, Button, Text } from '@/ui';
import {
  CancelChargeDialog,
  ChargeHistoryDialog,
  CorrectChargeDialog,
  PayChargeDialog,
} from './ChargeDialogs';
import { chargeCopy, competenceLabel, dateOrDash } from './copy';

type Action = 'pay' | 'correct' | 'cancel' | 'history';

/**
 * Cobranças com as ações administrativas de cada uma. Vencida e "vence em breve" são só alertas:
 * nenhuma ação daqui bloqueia o acesso da empresa.
 */
export function ChargeList({
  charges,
  companyName,
}: {
  charges: Charge[];
  companyName: (tenantId: string) => string;
}) {
  const [open, setOpen] = useState<{ charge: Charge; action: Action } | null>(null);
  const compact = useLayoutSize() === 'compact';
  const close = () => setOpen(null);
  const dialogProps = open
    ? { charge: open.charge, companyName: companyName(open.charge.tenantId), onClose: close }
    : null;

  return (
    <>
      {charges.map((charge, i) => {
        const copy = chargeCopy[charge.situation];
        return (
          <View
            key={charge.id}
            style={[styles.row, i < charges.length - 1 && styles.divider]}
            accessibilityLabel={`Cobrança ${competenceLabel(charge.competence)} de ${companyName(charge.tenantId)}`}
          >
            <View style={styles.copy}>
              <View style={styles.title}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                  {companyName(charge.tenantId)}
                </Text>
                <Badge {...copy} />
                {charge.origin === 'manual' ? <Badge label="Manual" tone="neutral" /> : null}
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`${competenceLabel(charge.competence)} · vence ${dateOrDash(charge.dueDate)}`}
                {charge.status === 'paid'
                  ? ` · pago ${dateOrDash(charge.paidAt)}${
                      charge.paidAmountCents !== null &&
                      charge.paidAmountCents !== charge.amountCents
                        ? ` (${formatCents(charge.paidAmountCents)})`
                        : ''
                    }`
                  : ''}
              </Text>
              {charge.notes ? (
                <Text variant="caption" color={color.textSecondary} numberOfLines={2}>
                  {charge.notes}
                </Text>
              ) : null}
            </View>
            <Text variant="figure" style={!compact && styles.amount}>
              {formatCents(charge.amountCents)}
            </Text>
            <View style={styles.actions}>
              {charge.status === 'pending' ? (
                <Button
                  label="Registrar pagamento"
                  size="sm"
                  variant="strong"
                  onPress={() => setOpen({ charge, action: 'pay' })}
                />
              ) : null}
              <Button
                label="Corrigir"
                size="sm"
                variant="outline"
                onPress={() => setOpen({ charge, action: 'correct' })}
              />
              {charge.status === 'pending' ? (
                <Button
                  label="Cancelar"
                  size="sm"
                  variant="ghost"
                  onPress={() => setOpen({ charge, action: 'cancel' })}
                />
              ) : null}
              <Button
                label="Histórico"
                size="sm"
                variant="ghost"
                onPress={() => setOpen({ charge, action: 'history' })}
              />
            </View>
          </View>
        );
      })}
      {dialogProps && open?.action === 'pay' ? <PayChargeDialog {...dialogProps} /> : null}
      {dialogProps && open?.action === 'correct' ? <CorrectChargeDialog {...dialogProps} /> : null}
      {dialogProps && open?.action === 'cancel' ? <CancelChargeDialog {...dialogProps} /> : null}
      {dialogProps && open?.action === 'history' ? <ChargeHistoryDialog {...dialogProps} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 220, gap: 2 },
  title: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] },
  shrink: { flexShrink: 1 },
  amount: { minWidth: 100, textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
