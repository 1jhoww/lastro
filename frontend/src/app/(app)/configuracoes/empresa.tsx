import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { useTenant } from '@/features/session/useTenant';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { color, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text } from '@/ui';

/** Dados da empresa ativa (GET /tenants/current). Somente leitura nesta etapa. */
export default function CompanySettings() {
  const tenant = useTenant();
  return (
    <Screen title="Empresa">
      {tenant.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar a empresa"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => tenant.refetch()}
            />
          }
        >
          {toApiError(tenant.error).userMessage}
        </Alert>
      ) : null}
      <Panel>
        {tenant.data ? (
          <View style={styles.list}>
            <Field label="Nome" value={tenant.data.name} />
            <Field
              label="Fuso horário"
              value={tenant.data.timezone}
              hint="Usado para validar datas de vencimento dos pedidos."
            />
            <Field label="No Lastro desde" value={formatDate(tenant.data.createdAt)} />
          </View>
        ) : (
          <View style={styles.list}>
            <Skeleton width="40%" height={18} />
            <Skeleton width="30%" height={18} />
          </View>
        )}
      </Panel>
    </Screen>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text variant="small" color={color.textSecondary}>
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
      {hint ? (
        <Text variant="small" color={color.textSecondary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[5], paddingTop: space[4] },
  field: { gap: 2 },
});
