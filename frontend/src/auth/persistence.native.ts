import * as SecureStore from 'expo-secure-store';
import { getReactNativePersistence, type Persistence } from 'firebase/auth';

/**
 * Android/iOS: a sessão do Firebase (com refresh token) vai para o Keychain (iOS) e para o
 * Keystore (Android) via expo-secure-store, nunca para AsyncStorage em texto puro.
 *
 * O SecureStore recomenda valores pequenos e chaves só com [A-Za-z0-9._-]. O usuário serializado
 * do Firebase passa disso, então o valor é dividido em partes e a chave é codificada.
 */
const CHUNK = 1800;
const keyFor = (key: string) => `fb.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function removeChunks(base: string) {
  const count = Number((await SecureStore.getItemAsync(`${base}.n`, options)) ?? '0');
  await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${base}.${i}`, options)),
  );
  await SecureStore.deleteItemAsync(`${base}.n`, options);
}

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = keyFor(key);
    const n = await SecureStore.getItemAsync(`${base}.n`, options);
    if (n === null) return null;
    const parts = await Promise.all(
      Array.from({ length: Number(n) }, (_, i) =>
        SecureStore.getItemAsync(`${base}.${i}`, options),
      ),
    );
    // Parte ausente = sessão corrompida: tratar como sem sessão em vez de montar JSON parcial.
    return parts.some((p) => p === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const base = keyFor(key);
    await removeChunks(base);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${base}.${i}`, p, options)));
    await SecureStore.setItemAsync(`${base}.n`, String(parts.length), options);
  },
  async removeItem(key: string): Promise<void> {
    await removeChunks(keyFor(key));
  },
};

export const authPersistence: Persistence = getReactNativePersistence(chunkedSecureStorage);
