import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ExecutionsScreen } from '@/features/finance/ExecutionsScreen';
export default function Page() {
  return (
    <FinanceAccess>
      <ExecutionsScreen />
    </FinanceAccess>
  );
}
