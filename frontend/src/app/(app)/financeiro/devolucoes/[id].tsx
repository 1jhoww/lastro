import { useLocalSearchParams } from 'expo-router';
import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ReturnScreen } from '@/features/finance/ReturnsScreen';
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <FinanceAccess>
      <ReturnScreen id={id} />
    </FinanceAccess>
  );
}
