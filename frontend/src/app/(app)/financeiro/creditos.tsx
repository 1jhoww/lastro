import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { CreditsScreen } from '@/features/finance/CreditsScreen';
export default function CreditsRoute() {
  return (
    <FinanceAccess>
      <CreditsScreen />
    </FinanceAccess>
  );
}
