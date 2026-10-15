import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Preferências pequenas e não secretas (ex.: última empresa escolhida). Web: localStorage;
 * nativo: SecureStore. Falhas de armazenamento nunca derrubam o app: a preferência só se perde.
 */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const kvStorage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(safeKey(key));
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
      else await SecureStore.setItemAsync(safeKey(key), value);
    } catch {
      // preferência perdida; sem impacto em segurança
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
      else await SecureStore.deleteItemAsync(safeKey(key));
    } catch {
      // idem
    }
  },
};
