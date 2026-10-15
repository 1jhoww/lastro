// `firebase/auth` reexporta `@firebase/auth`, que no React Native resolve para o build RN com
// getReactNativePersistence. A tipagem pública não declara a função; esta declaração cobre isso.
import 'firebase/auth';

declare module 'firebase/auth' {
  interface ReactNativeAsyncStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
