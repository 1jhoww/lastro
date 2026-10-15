import { configure } from '@testing-library/react-native';

// Sessão envolve várias etapas assíncronas (provedor, /me, preferência salva).
configure({ asyncUtilTimeout: 5000 });

// Adapter nativo conserva bytes entre instâncias. Cada teste inicia aparelho limpo.
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    _reset: () => values.clear(),
  };
});
beforeEach(() => jest.requireMock('expo-secure-store')._reset());

// O mock nativo do expo-crypto no Jest devolve undefined; o app real gera UUID v4. Os testes de
// idempotência precisam de chaves reais e distintas.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  randomUUID: () => jest.requireActual('node:crypto').randomUUID(),
}));
