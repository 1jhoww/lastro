import { useLocalSearchParams } from 'expo-router';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { OrderAdministrationScreen } from '@/features/finance/OrderAdministrationScreen';
export default function OrderAdministrationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FinanceAccess>
      <OrderAdministrationScreen key={id} id={id} />
    </FinanceAccess>
  );
}
