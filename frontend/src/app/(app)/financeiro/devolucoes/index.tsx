import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ReturnsScreen } from '@/features/finance/ReturnsScreen';
export default function Page() {
  return (
    <FinanceAccess>
      <ReturnsScreen />
    </FinanceAccess>
  );
}
