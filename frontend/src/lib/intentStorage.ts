import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { newIdempotencyKey } from './idempotency';
import { createChunkedIntentStore } from './intentStorageCore';
import { createWebIntentStore } from './webIntentStore';
import { ApiError } from '@/api/errors';
import type { IntentStore } from './intentStorageCore';
export { createWebIntentStore } from './webIntentStore';
const platformStore =
  Platform.OS === 'web'
    ? createWebIntentStore()
    : createChunkedIntentStore(
        {
          get: (key) => SecureStore.getItemAsync(key),
          set: (key, value) =>
            SecureStore.setItemAsync(key, value, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }),
          remove: (key) => SecureStore.deleteItemAsync(key),
        },
        newIdempotencyKey,
      );
export const intentStore: IntentStore = {
  async read(owner) {
    try {
      return await platformStore.read(owner);
    } catch (e) {
      throw new ApiError(
        0,
        'INTENT_STORAGE_UNAVAILABLE',
        e instanceof Error ? e.message : 'Armazenamento indisponível',
      );
    }
  },
  async change(owner, update) {
    try {
      return await platformStore.change(owner, update);
    } catch (e) {
      // Recusa de mudança de intenção conserva a classe de domínio usada pelos formulários.
      if (e instanceof Error && e.name === 'PendingIntentError') throw e;
      throw new ApiError(
        0,
        'INTENT_STORAGE_UNAVAILABLE',
        e instanceof Error ? e.message : 'Armazenamento indisponível',
      );
    }
  },
};
