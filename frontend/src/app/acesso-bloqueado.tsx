import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { accessCopy } from '@/features/session/accessCopy';
import { AccountFrame } from '@/features/session/AccountFrame';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Alert, Button } from '@/ui';

/** Empresa escolhida com assinatura suspensa/encerrada ou ainda em configuração. */
export default function BlockedAccess() {
  const session = useSession();
  const { gate } = session;
  const access = gate.kind === 'tenantBlocked' ? gate.membership.access : null;
  const copy = access && access !== 'allowed' ? accessCopy[access] : null;
  const many = (session.me?.memberships.length ?? 0) > 1;

  return (
    <AccountFrame title={copy?.title ?? 'Acesso indisponível'}>
      <Alert
        tone={copy?.tone === 'danger' ? 'danger' : 'warning'}
        title={copy?.label ?? 'Sem acesso'}
      >
        {copy?.body ?? 'Esta empresa não está disponível para você agora.'}
      </Alert>
      <View style={styles.actions}>
        <Button label="Verificar de novo" variant="strong" onPress={() => session.refetchMe()} />
        {many ? (
          <Link href="/empresas" asChild>
            <Button label="Escolher outra empresa" variant="outline" />
          </Link>
        ) : null}
      </View>
    </AccountFrame>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
