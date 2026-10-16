import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { ReceivablesScreen } from '@/features/finance/ReceivablesScreen';

export default function ReceivablesRoute() {
  return (
    <FinanceAccess>
      <ReceivablesScreen />
    </FinanceAccess>
  );
}
