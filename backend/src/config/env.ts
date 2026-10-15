import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { isIP } from 'node:net';

const localHost = z.string().regex(/^(127\.0\.0\.1|localhost):[1-9][0-9]{3,4}$/);
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  FIREBASE_MODE: z.enum(['emulator', 'production']).default('emulator'),
  FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,62}$/)
    .default('demo-lastro-phase-a'),
  FIREBASE_AUTH_EMULATOR_HOST: localHost.optional(),
  FIRESTORE_EMULATOR_HOST: localHost.optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: localHost.optional(),
  STORAGE_EMULATOR_HOST: z
    .string()
    .regex(/^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{3,4}$/)
    .optional(),
  STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,221}$/)
    .optional(),
  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),
  INVITATION_SECRET: z.string().min(43).optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(180),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  TRUST_PROXY_ADDRESSES: z.string().default(''),
  PUBLIC_ORIGIN: z.url().optional(),
});
export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mode: 'emulator' | 'production';
  projectId: string;
  invitationSecret: string;
  corsOrigins: string[];
  rateLimitMax: number;
  trustProxyHops: number;
  trustedProxyAddresses: string[];
  publicOrigin: string | undefined;
  storageBucket: string;
}
export function loadConfig(input: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(input);
  if (e.TRUST_PROXY_HOPS !== 0)
    throw new Error(
      'Trust proxy por contagem de hops não é seguro; configure endereços explícitos',
    );
  const trustedProxyAddresses = e.TRUST_PROXY_ADDRESSES.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const address of trustedProxyAddresses) {
    const [ip, prefix, extra] = address.split('/');
    const family = isIP(ip ?? '');
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)))
    )
      throw new Error('Proxy exige IP ou CIDR explícito; redes universais não são aceitas');
  }
  if (e.FIREBASE_MODE === 'emulator' && trustedProxyAddresses.length)
    throw new Error('Emulação local não aceita proxy confiável');
  if (e.FIREBASE_MODE === 'emulator') {
    if (e.NODE_ENV === 'production' || !e.FIREBASE_PROJECT_ID.startsWith('demo-'))
      throw new Error('Emulação exige projeto demo e ambiente não produtivo');
    if (e.TRUST_PROXY_HOPS !== 0) throw new Error('Emulação local não aceita proxy confiável');
    process.env.FIREBASE_AUTH_EMULATOR_HOST = e.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = e.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    process.env.FIREBASE_STORAGE_EMULATOR_HOST =
      e.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';
    const storageHost = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;
    if (e.STORAGE_EMULATOR_HOST && e.STORAGE_EMULATOR_HOST !== storageHost)
      throw new Error('Hosts do Storage Emulator divergentes');
    process.env.STORAGE_EMULATOR_HOST = storageHost;
    if (e.STORAGE_BUCKET && e.STORAGE_BUCKET !== `${e.FIREBASE_PROJECT_ID}.appspot.com`)
      throw new Error('Emulação aceita somente bucket do projeto demo');
  } else {
    if (
      e.NODE_ENV !== 'production' ||
      e.FIREBASE_PROJECT_ID.startsWith('demo-') ||
      input.FIREBASE_AUTH_EMULATOR_HOST ||
      input.FIRESTORE_EMULATOR_HOST ||
      input.FIREBASE_STORAGE_EMULATOR_HOST ||
      input.STORAGE_EMULATOR_HOST ||
      !e.PUBLIC_ORIGIN?.startsWith('https://') ||
      !e.INVITATION_SECRET
    )
      throw new Error('Configuração de produção insegura');
  }
  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    const u = new URL(origin);
    if (u.origin !== origin || (e.FIREBASE_MODE === 'production' && u.protocol !== 'https:'))
      throw new Error('CORS exige origens exatas seguras');
  }
  if (e.FIREBASE_MODE === 'production' && corsOrigins.length === 0)
    throw new Error('CORS de produção obrigatório');
  let invitationSecret = e.INVITATION_SECRET;
  if (!invitationSecret) {
    const directory = resolve('.local');
    const path = resolve(directory, 'invitation.key');
    mkdirSync(directory, { recursive: true });
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
    invitationSecret = readFileSync(path, 'utf8').trim();
    z.string().min(43).parse(invitationSecret);
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    mode: e.FIREBASE_MODE,
    projectId: e.FIREBASE_PROJECT_ID,
    invitationSecret,
    corsOrigins,
    rateLimitMax: e.RATE_LIMIT_MAX,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    trustedProxyAddresses,
    publicOrigin: e.PUBLIC_ORIGIN,
    storageBucket: e.STORAGE_BUCKET ?? `${e.FIREBASE_PROJECT_ID}.appspot.com`,
  };
}
