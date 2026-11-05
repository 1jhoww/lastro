import { ManagementAccess } from '@/features/management/Parts';
import { ExpenseForm } from '@/features/management/ExpenseForm';
import { Screen } from '@/layout/Screen';

export default function Route() {
  return (
    <ManagementAccess permission="payables:manage" title="Nova despesa">
      <Screen
        title="Nova despesa"
        description="Para compras de mercadoria, use Compras: o título é gerado na confirmação."
      >
        <ExpenseForm />
      </Screen>
    </ManagementAccess>
  );
}
