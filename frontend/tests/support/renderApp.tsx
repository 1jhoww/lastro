import type { ComponentType } from 'react';
import { Text } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderRouter } from 'expo-router/testing-library';
import { RootNavigator } from '@/navigation/RootNavigator';
import { SessionProvider } from '@/session/SessionContext';
import type { FakeGateway } from './fakeGateway';
import { testQueryClient } from './testQueryClient';

/** Tela simples que só diz onde estamos; telas reais entram por `overrides`. */
const marker = (label: string) => {
  const Screen = () => <Text>{`tela:${label}`}</Text>;
  Screen.displayName = `Marker(${label})`;
  return Screen;
};

/**
 * Monta o roteador real (RootNavigator com Stack.Protected e redirecionamentos) sobre rotas em
 * memória com a mesma estrutura de src/app.
 */
export async function renderApp(opts: {
  gateway: FakeGateway;
  fetch: typeof globalThis.fetch;
  initialUrl?: string;
  overrides?: Record<string, ComponentType>;
}) {
  const queryClient = testQueryClient();
  function RootLayout() {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider
          deps={{ gateway: opts.gateway, apiBaseUrl: 'http://api.test', fetch: opts.fetch }}
        >
          <RootNavigator />
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  const routes: Record<string, ComponentType> = {
    _layout: RootLayout,
    '(auth)/_layout': () => {
      const { Slot } = jest.requireActual('expo-router');
      return <Slot />;
    },
    '(auth)/entrar': marker('entrar'),
    '(auth)/recuperar-senha': marker('recuperar-senha'),
    '(app)/_layout': () => {
      const { Slot } = jest.requireActual('expo-router');
      return <Slot />;
    },
    '(app)/index': marker('inicio'),
    '(app)/estoque/index': marker('estoque'),
    empresas: marker('empresas'),
    'acesso-bloqueado': marker('acesso-bloqueado'),
    'sem-empresa': marker('sem-empresa'),
    'plataforma/_layout': () => {
      const { Slot } = jest.requireActual('expo-router');
      return <Slot />;
    },
    'plataforma/index': marker('plataforma'),
    sistema: marker('sistema'),
    convite: marker('convite'),
    'catalogo/_layout': () => {
      const { Slot } = jest.requireActual('expo-router');
      return <Slot />;
    },
    'catalogo/[slug]/index': marker('catalogo'),
    ...opts.overrides,
  };
  const result = await renderRouter(routes, { initialUrl: opts.initialUrl ?? '/' });
  return { ...result, queryClient };
}
