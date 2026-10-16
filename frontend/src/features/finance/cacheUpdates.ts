import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { queryKeys } from '@/api/queryKeys';
import type { FinancialResult, FinancialState, ReceiptInput, Receivable } from '@/api/types';

type Page<T> = { items: T[]; nextCursor: string | null };
type Allocation = { receivableId: string; amountCents: number };

/** Mesma regra de situação do backend (`titleStatus`), aplicada a valores já confirmados. */
function statusOf(
  t: Pick<
    Receivable,
    'originalCents' | 'outstandingCents' | 'cashCents' | 'creditCents' | 'canceledCents'
  >,
) {
  if (t.canceledCents === t.originalCents && t.originalCents > 0) return 'canceled' as const;
  if (t.originalCents === 0) return 'zero' as const;
  if (t.outstandingCents === 0) return 'paid' as const;
  if (t.cashCents + t.creditCents > 0) return 'partially_paid' as const;
  return 'open' as const;
}

function applyCash<T extends Receivable>(title: T, allocations: Allocation[]): T {
  const a = allocations.find((x) => x.receivableId === title.id);
  if (!a || a.amountCents > title.outstandingCents) return title;
  const next = {
    ...title,
    outstandingCents: title.outstandingCents - a.amountCents,
    cashCents: title.cashCents + a.amountCents,
  };
  return { ...next, status: statusOf(next) };
}

/**
 * Recebimento CONFIRMADO pela API (resposta validada por `sendReceipt`): aplica a alocação
 * enviada aos saldos já em cache, para a tela mostrar o novo saldo junto com a confirmação.
 * Nunca é chamado antes da resposta. As versões dos títulos continuam vindo da consulta
 * oficial que é refeita em seguida; novas operações ficam bloqueadas até ela terminar.
 */
export function applyConfirmedReceipt(
  cache: QueryClient,
  tenantId: string,
  body: ReceiptInput,
  result: FinancialResult,
) {
  const allocations = body.allocations;
  if (result.amountCents !== body.amountCents) return;
  for (const a of allocations)
    cache.setQueryData<Receivable>(queryKeys.receivable(tenantId, a.receivableId), (old) =>
      old ? applyCash(old, allocations) : old,
    );
  cache.setQueryData<FinancialState>(
    queryKeys.orderFinance(tenantId, result.orderId).concat('state'),
    (old) =>
      old
        ? {
            ...old,
            orderVersion: result.orderVersion,
            guardVersion: result.guardVersion,
            cashReceivedCents: old.cashReceivedCents + body.amountCents,
            cashSettledCents: old.cashSettledCents + body.amountCents,
            titles: old.titles.map((t) => applyCash(t, allocations)),
          }
        : old,
  );
  cache.setQueriesData<InfiniteData<Page<Receivable>>>(
    { queryKey: [...queryKeys.finance(tenantId), 'receivables'] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: p.items.map((t) => applyCash(t, allocations)),
            })),
          }
        : old,
  );
  cache.setQueryData<{ titles: { items: Receivable[]; complete: boolean } }>(
    [...queryKeys.finance(tenantId), 'overview'],
    (old) =>
      old
        ? {
            ...old,
            titles: {
              ...old.titles,
              items: old.titles.items.map((t) => applyCash(t, allocations)),
            },
          }
        : old,
  );
}

/**
 * Depois de um comando financeiro: marca tudo do Financeiro e de Pedidos como desatualizado,
 * mas só recarrega agora o que pertence ao registro afetado (pedido, cliente, parcelas).
 * Telas anteriores continuam montadas na pilha de navegação; recarregá-las todas de uma vez
 * gerava dezenas de consultas simultâneas e atrasava justamente o saldo da tela atual.
 */
export function refreshAfterFinanceCommand(
  cache: QueryClient,
  tenantId: string,
  ids: (string | null | undefined)[],
) {
  const wanted = ids.filter((id): id is string => Boolean(id));
  const related = (key: QueryKey) => {
    const text = JSON.stringify(key);
    return wanted.some((id) => text.includes(`"${id}"`));
  };
  const prefixes = [queryKeys.finance(tenantId), queryKeys.orders(tenantId)];
  return Promise.all(
    prefixes.map(async (queryKey) => {
      await cache.invalidateQueries({ queryKey, refetchType: 'none' });
      await cache.refetchQueries({
        queryKey,
        type: 'active',
        predicate: (q) => related(q.queryKey),
      });
    }),
  );
}

/** Ao voltar para uma tela já montada, atualiza somente as consultas dela que ficaram antigas. */
export function useRefetchStaleOnFocus(
  ...queries: { isStale: boolean; isFetching: boolean; refetch: () => unknown }[]
) {
  const latest = useRef(queries);
  useEffect(() => {
    latest.current = queries;
  });
  useFocusEffect(
    useCallback(() => {
      for (const q of latest.current) if (q.isStale && !q.isFetching) q.refetch();
    }, []),
  );
}
