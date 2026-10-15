import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { RefundsScreen } from '@/features/finance/RefundsScreen';
export default function RefundsRoute() {
  return (
    <FinanceAccess>
      <RefundsScreen />
    </FinanceAccess>
  );
}
