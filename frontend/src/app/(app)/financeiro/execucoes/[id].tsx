import { useLocalSearchParams } from 'expo-router';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ExecutionScreen } from '@/features/finance/ExecutionScreen';
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FinanceAccess>
      <ExecutionScreen id={id} />
    </FinanceAccess>
  );
}
