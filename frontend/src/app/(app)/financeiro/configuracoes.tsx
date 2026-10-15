import { FinanceAccess } from '@/features/finance/FinanceAccess';
import { SettingsScreen } from '@/features/finance/SettingsScreen';
export default function SettingsRoute() {
  return (
    <FinanceAccess permission="payment-settings:manage">
      <SettingsScreen />
    </FinanceAccess>
  );
}
