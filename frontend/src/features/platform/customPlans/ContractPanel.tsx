import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { CompanySubscription, ContractDiff, PlanFeature } from '@/api/types';
import { formatCents } from '@/lib/money';
import { space } from '@/theme';
import { Alert, Badge, Button, Panel, Skeleton, Text } from '@/ui';
import { useContractDiff } from '../api';
import { featureLabel, planLabel } from '../copy';
import { Detail, LoadError } from '../PlatformParts';

const names = (features: PlanFeature[]) => features.map((f) => featureLabel[f]).join(', ');
const signedCents = (value: number) => `${value > 0 ? '+' : '-'}${formatCents(Math.abs(value))}`;

/** Diferenças do contrato em relação a um conjunto de termos, em linguagem direta. */
function differences(compared: ContractDiff['againstOrigin']): string[] {
  const lines: string[] = [];
  if (compared.monthlyPriceDeltaCents !== 0)
    lines.push(`Valor: ${signedCents(compared.monthlyPriceDeltaCents)} por mês`);
  if (compared.userLimitDelta !== 0)
    lines.push(`Usuários: ${compared.userLimitDelta > 0 ? '+' : ''}${compared.userLimitDelta}`);
  if (compared.addedFeatures.length) lines.push(`A mais: ${names(compared.addedFeatures)}`);
  if (compared.removedFeatures.length) lines.push(`A menos: ${names(compared.removedFeatures)}`);
  return lines;
}

function Comparison({ label, lines, same }: { label: string; lines: string[]; same: string }) {
  return (
    <Detail label={label}>
      {lines.length ? (
        <View style={styles.lines}>
          {lines.map((line) => (
            <Text key={line} variant="body">
              {line}
            </Text>
          ))}
        </View>
      ) : (
        same
      )}
    </Detail>
  );
}

/** Origem do contrato personalizado e o quanto ele se afastou da oferta. */
export function ContractPanel({ subscription }: { subscription: CompanySubscription }) {
  const diff = useContractDiff(subscription.id);
  const data = diff.data;
  return (
    <Panel
      title="Contrato personalizado"
      description="Termos desta empresa, copiados da oferta na contratação."
      action={
        <Link href={`/plataforma/planos/${subscription.planId}` as Href} asChild>
          <Button label="Ver oferta" size="sm" variant="ghost" />
        </Link>
      }
    >
      {diff.isPending ? <Skeleton width="100%" height={60} /> : null}
      {diff.isError ? (
        <LoadError
          title="Comparação indisponível"
          error={diff.error}
          onRetry={() => diff.refetch()}
        />
      ) : null}
      {data ? (
        <>
          <Detail label="Plano de origem">
            <View style={styles.origin}>
              <Text variant="body">{data.planName}</Text>
              {data.planStatus === 'inactive' ? (
                <Badge label="Oferta desativada" tone="neutral" />
              ) : null}
            </View>
          </Detail>
          <Detail label="Versão contratada">
            {`Versão ${data.contractedVersion} de ${data.currentVersion}`}
          </Detail>
          <Detail label="Modelo oficial">
            {subscription.customContract?.sourcePlanCode
              ? planLabel(subscription.customContract.sourcePlanCode)
              : 'Nenhum'}
          </Detail>
          <Comparison
            label="Em relação ao contratado"
            lines={differences(data.againstOrigin)}
            same="Sem alterações individuais"
          />
          <Comparison
            label="Em relação à oferta atual"
            lines={differences(data.againstCurrent)}
            same="Igual à oferta atual"
          />
          {data.contractedVersion !== data.currentVersion ? (
            <View style={styles.notice}>
              <Alert title="A oferta mudou depois deste contrato">
                Esta empresa continua com os termos contratados. Para aplicar a versão nova, use
                Vincular plano personalizado.
              </Alert>
            </View>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
  origin: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
  notice: { paddingTop: space[3] },
});
