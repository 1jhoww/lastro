import { Link, type Href } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Button } from '@/ui';
import { canManageFinance } from './FinanceAccess';

export function FinanceNav() {
  const session = useSession();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {canManageFinance(session, 'receivables:read') ? (
        <>
          <Link href="/financeiro" asChild>
            <Button label="Contas a receber" variant="outline" />
          </Link>
          <Link href={'/financeiro/creditos' as Href} asChild>
            <Button label="Créditos de clientes" variant="outline" />
          </Link>
          <Link href={'/financeiro/reembolsos' as Href} asChild>
            <Button label="Obrigações de reembolso" variant="outline" />
          </Link>
          <Link href={'/financeiro/execucoes' as Href} asChild>
            <Button label="Execuções financeiras" variant="outline" />
          </Link>
          <Link href={'/financeiro/devolucoes' as Href} asChild>
            <Button label="Resoluções de devoluções" variant="outline" />
          </Link>
        </>
      ) : null}
      {canManageFinance(session, 'payment-settings:manage') ? (
        <Link href={'/financeiro/configuracoes' as Href} asChild>
          <Button label="Condições e formas" variant="outline" />
        </Link>
      ) : null}
    </View>
  );
}
