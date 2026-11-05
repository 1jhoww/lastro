import type { ReactNode } from 'react';
import { Link } from 'expo-router';
import { Screen } from '@/layout/Screen';
import type { Permission } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { Button, EmptyState, Panel } from '@/ui';
import { CircleAlert } from '@/ui/icons';

/**
 * Restringe uma tela por permissão de /me. Sem permissão, mostra acesso negado em vez de
 * montar a tela (e suas consultas). O backend recusaria as chamadas de qualquer forma. Só se chega
 * aqui por link direto: a navegação não mostra o que a pessoa não pode usar. A mensagem é neutra
 * porque a causa pode ser o perfil ou o contrato, e não oferece nada.
 */
export function RequirePermission({
  anyOf,
  title,
  children,
}: {
  anyOf: Permission[];
  title: string;
  children: ReactNode;
}) {
  const { permissions } = useSession();
  if (anyOf.some((p) => permissions.includes(p))) return <>{children}</>;
  return <AccessDenied title={title} />;
}

export function AccessDenied({ title }: { title: string }) {
  return (
    <Screen title={title}>
      <Panel flush>
        <EmptyState
          icon={CircleAlert}
          title="Você não tem acesso a esta área"
          description="Esta função não está disponível para você."
          action={
            <Link href="/" asChild>
              <Button label="Ir para o início" variant="strong" />
            </Link>
          }
        />
      </Panel>
    </Screen>
  );
}
