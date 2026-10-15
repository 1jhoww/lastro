import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ReceivablesScreen } from '@/features/finance/ReceivablesScreen';

export default function FinanceRoute() {
  return (
    <FinanceAccess>
      <ReceivablesScreen />
    </FinanceAccess>
  );
}
