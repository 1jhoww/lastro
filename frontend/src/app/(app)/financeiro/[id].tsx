import { useLocalSearchParams } from 'expo-router';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ReceivableScreen } from '@/features/finance/ReceivableScreen';

export default function ReceivableRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FinanceAccess>
      <ReceivableScreen key={id} id={id} />
    </FinanceAccess>
  );
}
