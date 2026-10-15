import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { randomBytes } from 'node:crypto';
describe('Configuração segura antes de inicializar SDK', () => {
  it('recusa trust proxy por hops e redes universais', () => {
    for (const values of [
      { TRUST_PROXY_HOPS: '1' },
      { TRUST_PROXY_ADDRESSES: '0.0.0.0/0' },
      { TRUST_PROXY_ADDRESSES: '::/0' },
      { TRUST_PROXY_ADDRESSES: 'loopback' },
    ])
      expect(() => loadConfig(values)).toThrow();
  });
  it('recusa alias remoto de Storage, bucket real e hosts divergentes', () => {
    expect(() => loadConfig({ STORAGE_EMULATOR_HOST: 'http://remote.invalid:9199' })).toThrow();
    expect(() => loadConfig({ STORAGE_BUCKET: 'real-bucket.appspot.com' })).toThrow();
    expect(() =>
      loadConfig({
        FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
        STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9299',
      }),
    ).toThrow();
  });
  it('produção recusa ambas as variáveis do Storage Emulator', () => {
    for (const key of ['FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'])
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          FIREBASE_MODE: 'production',
          FIREBASE_PROJECT_ID: 'real-project',
          PUBLIC_ORIGIN: 'https://api.example.invalid',
          INVITATION_SECRET: randomBytes(32).toString('base64url'),
          [key]: key.startsWith('FIREBASE') ? '127.0.0.1:9199' : 'http://127.0.0.1:9199',
        }),
      ).toThrow();
  });
  it('recusa emulador com projeto real ou NODE_ENV production', () => {
    expect(() =>
      loadConfig({ FIREBASE_MODE: 'emulator', FIREBASE_PROJECT_ID: 'real-project' }),
    ).toThrow();
    expect(() =>
      loadConfig({
        FIREBASE_MODE: 'emulator',
        FIREBASE_PROJECT_ID: 'demo-tests',
        NODE_ENV: 'production',
      }),
    ).toThrow();
  });
  it('recusa produção com hosts de emulador', () =>
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FIREBASE_MODE: 'production',
        FIREBASE_PROJECT_ID: 'real-project',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        PUBLIC_ORIGIN: 'https://api.example.invalid',
        INVITATION_SECRET: randomBytes(32).toString('base64url'),
      }),
    ).toThrow());
  it('recusa produção sem segredo/origens HTTPS e emuladores remotos', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FIREBASE_MODE: 'production',
        FIREBASE_PROJECT_ID: 'real-project',
      }),
    ).toThrow();
    expect(() =>
      loadConfig({ FIREBASE_AUTH_EMULATOR_HOST: 'remote.example.invalid:9099' }),
    ).toThrow();
  });
});
