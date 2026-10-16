import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { FinanceOverviewScreen } from '@/features/finance/FinanceOverviewScreen';

export default function FinanceRoute() {
  const { pedido } = useLocalSearchParams<{ pedido?: string }>();
  // Links antigos `/financeiro?pedido=` abriam a lista de títulos do pedido.
  if (pedido)
    return <Redirect href={`/financeiro/receber?pedido=${encodeURIComponent(pedido)}` as Href} />;
  return (
    <FinanceAccess>
      <FinanceOverviewScreen />
    </FinanceAccess>
  );
}
