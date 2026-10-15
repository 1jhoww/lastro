import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { BootScreen, MeErrorScreen } from '@/features/session/StatusScreens';
import { allowedRoots, homeFor, type RouteRoot } from '@/session/gate';
import { useSession } from '@/session/SessionContext';
import { color } from '@/theme';

/**
 * Proteção de rotas em duas camadas:
 * 1. `Stack.Protected` desmonta grupos que o estado da sessão não permite (nada privado
 *    renderiza, nem por um quadro).
 * 2. Um efeito leva à tela inicial certa quando a rota atual não é permitida, cobrindo a troca
 *    com a tela de abertura para não haver salto visual.
 *
 * Isto é experiência, não segurança: o backend revalida token, vínculo e permissão em cada chamada.
 */
export function RootNavigator() {
  const session = useSession();
  const { gate } = session;
  const segments = useSegments();
  const router = useRouter();
  const roots = allowedRoots(gate, __DEV__);
  const root = segments[0] as string | undefined;
  const isPublic = root === 'catalogo';
  const settled = gate.kind !== 'boot' && gate.kind !== 'meError';
  const allowed =
    isPublic || root === '+not-found' || (root !== undefined && roots.includes(root as RouteRoot));

  useEffect(() => {
    if (!settled || allowed) return;
    // Convite aberto antes do login tem prioridade: depois de entrar, volta para o aceite.
    const home = session.pendingInvite ? '/convite' : homeFor(gate);
    if (home) router.replace(home as Href);
  }, [settled, allowed, gate, router, session.pendingInvite]);

  if (gate.kind === 'boot' && !isPublic) return <BootScreen />;
  if (gate.kind === 'meError' && !isPublic)
    return (
      <MeErrorScreen onRetry={() => session.refetchMe()} onSignOut={() => session.signOut()} />
    );

  const can = (r: RouteRoot) => roots.includes(r);
  return (
    <View style={styles.fill}>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}
      >
        <Stack.Protected guard={can('(auth)')}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={can('(app)')}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={can('empresas')}>
          <Stack.Screen name="empresas" />
        </Stack.Protected>
        <Stack.Protected guard={can('acesso-bloqueado')}>
          <Stack.Screen name="acesso-bloqueado" />
        </Stack.Protected>
        <Stack.Protected guard={can('sem-empresa')}>
          <Stack.Screen name="sem-empresa" />
        </Stack.Protected>
        <Stack.Protected guard={can('plataforma')}>
          <Stack.Screen name="plataforma" />
        </Stack.Protected>
        <Stack.Protected guard={can('sistema')}>
          <Stack.Screen name="sistema" />
        </Stack.Protected>
        <Stack.Screen name="convite" />
        <Stack.Screen name="catalogo" />
      </Stack>
      {allowed ? null : (
        <View style={StyleSheet.absoluteFill}>
          <BootScreen />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
