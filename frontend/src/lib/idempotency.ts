import { randomUUID } from 'expo-crypto';
import { useCallback, useRef } from 'react';

/**
 * Idempotency-Key (UUID) por intenção, exigida pelo backend em entradas/ajustes de estoque e
 * confirmar/expedir/cancelar pedido.
 *
 * Regra do contrato: repetir após falha de rede usa a MESMA chave; uma nova intenção (outro
 * conteúdo) usa chave nova. O hook guarda a chave até `reset()` ser chamado após sucesso ou
 * quando o usuário muda o conteúdo da operação.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}

export function useIntentKey() {
  const key = useRef<string | null>(null);
  const current = useCallback(() => (key.current ??= newIdempotencyKey()), []);
  const reset = useCallback(() => {
    key.current = null;
  }, []);
  return { current, reset };
}
