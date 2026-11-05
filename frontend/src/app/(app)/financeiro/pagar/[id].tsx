import { ManagementAccess } from '@/features/management/Parts';
import { useLocalSearchParams } from 'expo-router';
import { PayableDetail } from '@/features/management/PayableDetail';

export default function Route() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ManagementAccess permission="payables:read" title="Título">
      <PayableDetail id={id} key={id} />
    </ManagementAccess>
  );
}
