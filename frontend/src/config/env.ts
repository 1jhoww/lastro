import { z } from 'zod';

/**
 * Configuração pública do app (EXPO_PUBLIC_*), validada na inicialização.
 * Nada aqui é segredo: chaves web do Firebase são identificadores públicos por desenho.
 * Sem fallback para ambiente produtivo: na ausência de valores, o app recusa iniciar a integração.
 */
const schema = z.object({
  apiUrl: z.url(),
  firebaseProjectId: z.string().min(1),
  firebaseApiKey: z.string().min(1),
  /** Somente desenvolvimento. Presente = Auth Emulator. */
  authEmulatorUrl: z.url().optional(),
  /** Origem do frontend publicado, para copiar o catálogo em Android/iOS. */
  webBaseUrl: z.url().optional(),
});

export type Env = z.infer<typeof schema>;

// Expo só embute variáveis acessadas literalmente como process.env.EXPO_PUBLIC_*.
const raw = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authEmulatorUrl: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL || undefined,
  webBaseUrl: process.env.EXPO_PUBLIC_WEB_BASE_URL || undefined,
};

const parsed = schema.safeParse(raw);

/** null quando o ambiente não está configurado; telas exibem isso em vez de simular dados. */
export const env: Env | null = parsed.success ? parsed.data : null;

export const envProblem: string | null = parsed.success
  ? null
  : `Configuração ausente: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. Copie .env.example para .env.`;
