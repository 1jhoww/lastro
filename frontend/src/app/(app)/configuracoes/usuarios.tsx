import { RequirePermission } from '@/features/session/RequirePermission';
import { UsersScreen } from '@/features/users/UsersScreen';

export default function UsersRoute() {
  return (
    <RequirePermission title="Usuários" anyOf={['users:manage']}>
      <UsersScreen />
    </RequirePermission>
  );
}
