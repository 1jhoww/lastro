import { StyleSheet, View } from 'react-native';
import { AccountFrame } from '@/features/session/AccountFrame';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Button, EmptyState, Panel } from '@/ui';
import { Building } from '@/ui/icons';

/** Conta válida, mas sem vínculo com nenhuma empresa. */
export default function NoTenant() {
  const session = useSession();
  return (
    <AccountFrame title="Nenhuma empresa ainda">
      <Panel flush>
        <EmptyState
          icon={Building}
          title={`${session.user?.email ?? 'Esta conta'} não participa de nenhuma empresa`}
          description="Para entrar, abra o link de convite que o administrador da empresa enviou para este e-mail. Se ele já foi aceito, verifique de novo."
          action={
            <View style={styles.actions}>
              <Button
                label="Verificar de novo"
                variant="strong"
                onPress={() => session.refetchMe()}
              />
            </View>
          }
        />
      </Panel>
    </AccountFrame>
  );
}

const styles = StyleSheet.create({ actions: { flexDirection: 'row', gap: space[2] } });
