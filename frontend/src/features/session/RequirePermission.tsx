import type { ReactNode } from 'react';
import { Link } from 'expo-router';
import { Screen } from '@/layout/Screen';
import type { Permission } from '@/navigation/destinations';
import { useSession } from '@/session/SessionContext';
import { Button, EmptyState, Panel } from '@/ui';
import { Lock } from '@/ui/icons';

/**
 * Restringe uma tela por permissão de /me. Sem permissão, mostra acesso negado em vez de
 * montar a tela (e suas consultas). O backend recusaria as chamadas de qualquer forma.
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
          icon={Lock}
          title="Você não tem acesso a esta área"
          description="Seu perfil nesta empresa não inclui esta função. Se precisar dela, fale com um administrador."
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
