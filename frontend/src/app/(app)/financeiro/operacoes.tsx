import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { OperationsScreen } from '@/features/finance/OperationsScreen';

export default function OperationsRoute() {
  return (
    <FinanceAccess>
      <OperationsScreen />
    </FinanceAccess>
  );
}
