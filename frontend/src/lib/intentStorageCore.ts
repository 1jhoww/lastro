/** Persistência estrita: nenhum adapter pode ocultar erro ou confirmar escrita em memória. */
export type DurableIntent = {
  scope: string;
  uid: string;
  tenantId: string;
  kind: string;
  resourceId: string;
  intentId: string;
  key: string;
  fingerprint: string;
  body: Record<string, unknown>;
  status: 'prepared' | 'unknown' | 'accepted' | 'superseded';
  executionId: string | null;
  revision: number | null;
  fencingToken: number | null;
  lastOfficialStatus?: string;
};
export type IntentStore = {
  read(owner: string): Promise<DurableIntent[]>;
  change(
    owner: string,
    update: (rows: DurableIntent[]) => DurableIntent[],
  ): Promise<DurableIntent[]>;
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function readIntentRows(raw: string | null, owner: string): DurableIntent[] {
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('Registro de intenções inválido');
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('scope' in row) || !('body' in row))
      throw new Error('Intenção inválida');
    const r = row as DurableIntent;
    if (
      typeof r.uid !== 'string' ||
      typeof r.tenantId !== 'string' ||
      `${r.uid}:${r.tenantId}` !== owner ||
      typeof r.kind !== 'string' ||
      typeof r.resourceId !== 'string' ||
      r.scope !== `${owner}:${r.kind}:${r.resourceId}` ||
      !/^[0-9a-f-]{36}$/i.test(r.key) ||
      r.intentId !== r.key ||
      !['prepared', 'unknown', 'accepted', 'superseded'].includes(r.status) ||
      !r.body ||
      typeof r.body !== 'object' ||
      Array.isArray(r.body) ||
      r.fingerprint !== canonicalJson(r.body) ||
      seen.has(r.scope) ||
      !(r.executionId === null || typeof r.executionId === 'string') ||
      ![r.revision, r.fencingToken].every((v) => v === null || (Number.isSafeInteger(v) && v > 0))
    )
      throw new Error('Registro durável divergente; consulte o estado oficial');
    seen.add(r.scope);
  }
  return rows as DurableIntent[];
}

type StrictKV = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
/** Snapshot em fragmentos pequenos. Ponteiro muda somente depois de todos os fragmentos verificados. */
export function createChunkedIntentStore(kv: StrictKV, generation: () => string): IntentStore {
  const queues = new Map<string, Promise<unknown>>();
  const prefix = (owner: string) =>
    `lastro_intents_${Array.from(owner)
      .map((c) => c.codePointAt(0)!.toString(16))
      .join('_')}`;
  async function read(owner: string) {
    const p = prefix(owner);
    const manifest = await kv.get(`${p}_head`);
    if (manifest === null) return [];
    const m = JSON.parse(manifest) as { generation: string; count: number };
    if (
      !/^[a-zA-Z0-9_-]+$/.test(m.generation) ||
      !Number.isSafeInteger(m.count) ||
      m.count < 1 ||
      m.count > 20000
    )
      throw new Error('Checkpoint local inválido');
    let raw = '';
    for (let i = 0; i < m.count; i++) {
      const chunk = await kv.get(`${p}_${m.generation}_${i}`);
      if (chunk === null) throw new Error('Checkpoint local incompleto');
      raw += chunk;
    }
    return readIntentRows(raw, owner);
  }
  return {
    read,
    change(owner, update) {
      const work = (queues.get(owner) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const rows = update(await read(owner));
          const raw = canonicalJson(rows);
          readIntentRows(raw, owner);
          const p = prefix(owner),
            gen = generation(),
            count = Math.ceil(raw.length / 256);
          const oldManifest = await kv.get(`${p}_head`);
          for (let i = 0; i < count; i++) {
            const key = `${p}_${gen}_${i}`,
              chunk = raw.slice(i * 256, (i + 1) * 256);
            await kv.set(key, chunk);
            if ((await kv.get(key)) !== chunk) throw new Error('Escrita local não confirmada');
          }
          const manifest = canonicalJson({ generation: gen, count });
          await kv.set(`${p}_head`, manifest);
          if ((await kv.get(`${p}_head`)) !== manifest || canonicalJson(await read(owner)) !== raw)
            throw new Error('Checkpoint local não confirmado');
          // Limpeza não afeta confirmação. Nunca apaga geração vigente ou intenção ambígua.
          if (oldManifest) {
            const old = JSON.parse(oldManifest) as { generation: string; count: number };
            for (let i = 0; i < old.count; i++)
              await kv.remove(`${p}_${old.generation}_${i}`).catch(() => {});
          }
          return rows;
        });
      queues.set(owner, work);
      return work;
    },
  };
}
