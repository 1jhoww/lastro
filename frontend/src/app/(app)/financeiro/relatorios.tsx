import { FinanceNav } from '@/features/finance/FinanceNav';
import { ReportAccess } from '@/features/reports/ReportAccess';
import { ReportsScreen } from '@/features/reports/ReportsScreen';
import { AccessDenied } from '@/features/session/RequirePermission';
import { useSession } from '@/session/SessionContext';

export default function FinanceReportsRoute() {
  return (
    <ReportAccess>
      <FinanceReports />
    </ReportAccess>
  );
}

/** Os mesmos relatórios de `/relatorios`, só das categorias financeiras. */
function FinanceReports() {
  const { permissions } = useSession();
  if (!permissions.includes('receivables:read') && !permissions.includes('financial-reports:read'))
    return <AccessDenied title="Relatórios" />;
  return (
    <ReportsScreen
      only={['financial', 'management']}
      description="Análise do financeiro, com filtros e exportação."
      nav={<FinanceNav />}
    />
  );
}
