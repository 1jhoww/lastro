import { fetch as expoFetch } from 'expo/fetch';
/** Expo fornece ArrayBuffer/stream binário no dispositivo; JSON mantém transporte existente. */
export const defaultFetch: typeof globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return /\.(pdf|csv)(?:\?|$)/.test(url) ? expoFetch(input, init) : globalThis.fetch(input, init);
};
