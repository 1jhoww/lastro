import { useCallback, useSyncExternalStore } from 'react';
import { toApiError, type ApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import { intentStore } from './intentStorage';
import { canonicalJson, type DurableIntent, type IntentStore } from './intentStorageCore';

/**
 * Intenção de operação crítica e sua Idempotency-Key (entradas e ajustes de estoque; confirmar,
 * expedir e cancelar pedido).
 *
 * Regras dos contratos idempotentes do backend:
 * - uma chave por intenção; repetir a MESMA intenção (mesmo conteúdo) reutiliza a chave e o
 *   servidor devolve o resultado já gravado, sem duplicar;
 * - conteúdo diferente exige chave nova (o servidor recusa chave reaproveitada com outro corpo);
 * - depois de timeout ou resposta ambígua, nenhuma chave nova é gerada sozinha: a intenção fica
 *   "pendente" até ser repetida com a mesma chave ou descartada por decisão explícita.
 *
 * O registro vive fora das telas (sobrevive a fechar e reabrir o formulário) e é separado por
 * usuário, empresa, tipo de operação e recurso (produto ou pedido).
 * Financeiro usa prepare/finish assíncronos e persistência durável antes do HTTP. keyFor/clear
 * síncronos permanecem compatíveis com comandos comerciais/estoque anteriores em memória.
 */

export type MovementKind = 'entry' | 'adjustment';
export type OrderCommandKind = 'confirm' | 'dispatch' | 'cancel';
export type IntentKind =
  | MovementKind
  | OrderCommandKind
  | 'receipt'
  | 'finance-command'
  | 'finance-setting'
  | 'finance-resolution'
  | 'finance-step'
  | 'finance-tracking'
  | 'order-discount'
  | 'catalog-setting';

/** Resultado de um envio, do ponto de vista de quem registrou. */
export type Outcome =
  | { status: 'confirmed' }
  /** O servidor respondeu e recusou: nada foi gravado. */
  | { status: 'rejected'; error: ApiError }
  /** Sem resposta conclusiva (rede, timeout, 5xx): pode ou não ter sido gravado. */
  | { status: 'unknown'; error: ApiError };

export function outcomeOf(e: unknown): Exclude<Outcome, { status: 'confirmed' }> {
  const error = toApiError(e);
  return error.kind === 'network' || error.kind === 'server'
    ? { status: 'unknown', error }
    : { status: 'rejected', error };
}

export type Intent = {
  fingerprint: string;
  key: string;
  unknown: boolean;
  /** Corpo enviado, para repetir exatamente a mesma intenção. */
  body: Record<string, unknown>;
  executionId?: string | null;
};

/** Tentativa de nova intenção enquanto outra do mesmo recurso tem resultado desconhecido. */
export class PendingIntentError extends Error {
  constructor() {
    super('Há uma movimentação com resultado desconhecido para este produto');
    this.name = 'PendingIntentError';
  }
}

/** Serialização estável do corpo: mesma intenção = mesmo texto, independente da ordem. */
export function fingerprintOf(body: Record<string, unknown>): string {
  return canonicalJson(body);
}

export function createIntentLedger(storage?: IntentStore) {
  const intents = new Map<string, Intent>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const ownerOf = (scope: string) => scope.split(':').slice(0, 2).join(':');
  const sync = (owner: string, rows: DurableIntent[]) => {
    for (const scope of intents.keys())
      if (
        scope.startsWith(`${owner}:`) &&
        !['entry', 'adjustment', 'confirm', 'dispatch', 'cancel'].includes(
          scope.split(':')[2] ?? '',
        )
      )
        intents.delete(scope);
    rows.forEach((r) =>
      intents.set(r.scope, {
        fingerprint: r.fingerprint,
        key: r.key,
        unknown: r.status !== 'superseded',
        body: r.body,
        executionId: r.executionId,
      }),
    );
    emit();
  };
  const ledger = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (scope: string) => intents.get(scope),
    list: (uid: string, tenantId: string) =>
      [...intents.entries()].filter(([s]) => s.startsWith(`${uid}:${tenantId}:`)),
    async persistedPending(scope: string) {
      return storage ? (await storage.read(ownerOf(scope))).some((r) => r.scope === scope) : false;
    },
    async hydrate(uid: string, tenantId: string) {
      if (!storage) return;
      const owner = `${uid}:${tenantId}`;
      sync(owner, await storage.read(owner));
    },
    async prepare(scope: string, body: Record<string, unknown>, executionId: string | null = null) {
      if (!storage) return ledger.keyFor(scope, body);
      const [uid, tenantId, kind, ...resource] = scope.split(':');
      if (!uid || !tenantId || !kind || !resource.length)
        throw new Error('Escopo financeiro inválido');
      const resourceId = resource.join(':'),
        owner = ownerOf(scope),
        fingerprint = fingerprintOf(body);
      let key = '';
      const economic = [
        'receipt',
        'finance-command',
        'finance-resolution',
        'finance-step',
        'finance-tracking',
        'order-discount',
      ];
      const rows = await storage.change(owner, (current) => {
        const existing = current.find((r) => r.scope === scope);
        const memory = intents.get(scope);
        if (!existing && memory?.unknown && memory.fingerprint !== fingerprint)
          throw new PendingIntentError();
        if (existing && existing.fingerprint !== fingerprint) throw new PendingIntentError();
        if (
          economic.includes(kind) &&
          current.some(
            (r) =>
              r.resourceId === resourceId &&
              economic.includes(r.kind) &&
              r.scope !== scope &&
              !(
                kind === 'finance-step' &&
                r.status === 'accepted' &&
                r.executionId === executionId
              ),
          )
        )
          throw new PendingIntentError();
        if (existing) {
          key = existing.key;
          return current;
        }
        key = memory?.fingerprint === fingerprint ? memory.key : newIdempotencyKey();
        const next: DurableIntent[] = [
          ...current,
          {
            scope,
            uid,
            tenantId,
            kind,
            resourceId,
            key,
            intentId: key,
            fingerprint,
            body: JSON.parse(fingerprint),
            status: 'prepared',
            executionId,
            revision: null,
            fencingToken: null,
          },
        ];
        if (
          kind === 'finance-step' &&
          executionId &&
          !current.some((r) => r.status === 'accepted' && r.executionId === executionId)
        ) {
          const trackKey = newIdempotencyKey(),
            trackingBody = { executionId };
          next.push({
            scope: `${owner}:finance-tracking:${resourceId}`,
            uid,
            tenantId,
            kind: 'finance-tracking',
            resourceId,
            key: trackKey,
            intentId: trackKey,
            fingerprint: fingerprintOf(trackingBody),
            body: trackingBody,
            status: 'accepted',
            executionId,
            revision: null,
            fencingToken: null,
          });
        }
        return next;
      });
      sync(owner, rows);
      return key;
    },
    async accepted(scope: string, executionId: string, revision: number, fencingToken: number) {
      if (!storage) {
        ledger.clear(scope);
        return;
      }
      const owner = ownerOf(scope);
      sync(
        owner,
        await storage.change(owner, (rows) =>
          rows.map((r) =>
            r.scope === scope
              ? { ...r, status: 'accepted', executionId, revision, fencingToken }
              : r,
          ),
        ),
      );
    },
    /** Retomada explícita arquiva passo incerto; nunca equivale a abort ou apaga sua chave/corpo. */
    async preserveAdvanceForResume(scope: string, executionId: string) {
      if (!storage) return;
      const owner = ownerOf(scope);
      sync(
        owner,
        await storage.change(owner, (rows) =>
          rows.map((r) => {
            if (r.scope !== scope) return r;
            if (r.body.kind !== 'advance' || r.executionId !== executionId)
              throw new PendingIntentError();
            const resourceId = `${r.resourceId}:${r.key}`;
            return {
              ...r,
              scope: `${owner}:finance-step-history:${resourceId}`,
              kind: 'finance-step-history',
              resourceId,
              status: 'superseded',
            };
          }),
        ),
      );
    },
    async observeExecution(
      uid: string,
      tenantId: string,
      executionId: string,
      revision: number,
      fencingToken: number,
      status: string,
    ) {
      if (!storage) return;
      const owner = `${uid}:${tenantId}`;
      if (!(await storage.read(owner)).some((r) => r.executionId === executionId)) return;
      sync(
        owner,
        await storage.change(owner, (rows) =>
          rows.map((r) =>
            r.executionId === executionId
              ? { ...r, revision, fencingToken, lastOfficialStatus: status }
              : r,
          ),
        ),
      );
    },
    async finish(scope: string) {
      if (storage) {
        const owner = ownerOf(scope);
        sync(owner, await storage.change(owner, (rows) => rows.filter((r) => r.scope !== scope)));
      } else ledger.clear(scope);
    },
    async reject(scope: string) {
      const current = intents.get(scope);
      await ledger.finish(scope);
      if (current) {
        intents.set(scope, { ...current, unknown: false });
        emit();
      }
    },
    async finishExecution(uid: string, tenantId: string, executionId: string) {
      const owner = `${uid}:${tenantId}`;
      if (storage)
        sync(
          owner,
          await storage.change(owner, (rows) => rows.filter((r) => r.executionId !== executionId)),
        );
    },
    /** Chave para enviar este conteúdo. Mesmo conteúdo da intenção atual = mesma chave. */
    keyFor(scope: string, body: Record<string, unknown>): string {
      const fingerprint = fingerprintOf(body);
      const current = intents.get(scope);
      if (current?.fingerprint === fingerprint) return current.key;
      if (current?.unknown) throw new PendingIntentError();
      const next = { fingerprint, key: newIdempotencyKey(), unknown: false, body };
      intents.set(scope, next);
      emit();
      return next.key;
    },
    markUnknown(scope: string) {
      const current = intents.get(scope);
      if (current && !current.unknown) {
        intents.set(scope, { ...current, unknown: true });
        emit();
      }
    },
    markRejected(scope: string) {
      const current = intents.get(scope);
      if (current?.unknown) {
        intents.set(scope, { ...current, unknown: false });
        emit();
      }
    },
    /** Confirmada pelo servidor ou descartada pela pessoa: a próxima intenção usa chave nova. */
    clear(scope: string) {
      if (intents.delete(scope)) emit();
    },
    reset() {
      intents.clear();
      emit();
    },
  };
  return ledger;
}

export type IntentLedger = ReturnType<typeof createIntentLedger>;

/** Registro único do app. */
export const intentLedger = createIntentLedger(intentStore);

export const intentScope = (uid: string, tenantId: string, kind: IntentKind, resourceId: string) =>
  `${uid}:${tenantId}:${kind}:${resourceId}`;

/** Intenção pendente (resultado desconhecido) de um escopo, reativa. */
export function usePendingIntent(scope: string | null) {
  const subscribe = useCallback((l: () => void) => intentLedger.subscribe(l), []);
  return useSyncExternalStore(subscribe, () => {
    if (!scope) return undefined;
    const intent = intentLedger.get(scope);
    return intent?.unknown ? intent : undefined;
  });
}

export function useOtherOrderIntent(
  uid: string,
  tenantId: string,
  orderId: string,
  ownKind: IntentKind,
) {
  return useSyncExternalStore(
    intentLedger.subscribe,
    () =>
      intentLedger
        .list(uid, tenantId)
        .find(
          ([scope, intent]) =>
            scope.endsWith(`:${orderId}`) &&
            [
              'receipt',
              'finance-command',
              'finance-resolution',
              'finance-step',
              'finance-tracking',
              'order-discount',
            ].some((k) => scope.includes(`:${k}:`) && k !== ownKind) &&
            intent.unknown,
        )?.[1],
  );
}

/**
 * Tempo máximo de espera por uma operação crítica. Estourado, o resultado é desconhecido (o
 * servidor pode ter gravado) e a repetição usa a mesma Idempotency-Key.
 */
export const criticalRequest = { timeoutMs: 20_000 };

/** Executa a chamada com um AbortSignal que dispara no prazo de `criticalRequest`. */
export async function withDeadline<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), criticalRequest.timeoutMs);
  try {
    return await call(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
