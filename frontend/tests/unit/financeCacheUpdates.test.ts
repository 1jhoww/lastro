import { QueryObserver } from '@tanstack/react-query';
import { testQueryClient } from '../support/testQueryClient';
import { queryKeys } from '@/api/queryKeys';
import type { Receivable } from '@/api/types';
import { applyConfirmedReceipt, refreshAfterFinanceCommand } from '@/features/finance/cacheUpdates';
import {
  financialResult,
  financialState,
  receivable,
  receiptBody,
} from '../support/financeFixtures';

const t = 't1';
const stateKey = queryKeys.orderFinance(t, 'o1').concat('state');

describe('atualização de cache após pagamento confirmado', () => {
  it('aplica a alocação confirmada ao título, à posição do pedido, às listas e ao painel', () => {
    const cache = testQueryClient();
    cache.setQueryData(queryKeys.receivable(t, 'r1'), receivable());
    cache.setQueryData(stateKey, financialState());
    cache.setQueryData(queryKeys.receivables(t, { limit: 25 }), {
      pages: [{ items: [receivable(), receivable({ id: 'r9' })], nextCursor: null }],
      pageParams: [undefined],
    });
    cache.setQueryData([...queryKeys.finance(t), 'overview'], {
      titles: { items: [receivable()], complete: true },
      payments: { items: [], complete: true },
    });
    applyConfirmedReceipt(cache, t, receiptBody, financialResult);
    const title = cache.getQueryData<Receivable>(queryKeys.receivable(t, 'r1'))!;
    expect(title).toMatchObject({
      outstandingCents: 1500,
      cashCents: 500,
      status: 'partially_paid',
    });
    const state = cache.getQueryData<ReturnType<typeof financialState>>(stateKey)!;
    expect(state.titles[0]).toMatchObject({ outstandingCents: 1500, cashCents: 500 });
    expect(state).toMatchObject({ guardVersion: 8, cashSettledCents: 500 });
    const list = cache.getQueryData<{ pages: { items: Receivable[] }[] }>(
      queryKeys.receivables(t, { limit: 25 }),
    )!;
    expect(list.pages[0]!.items.map((x) => x.outstandingCents)).toEqual([1500, 2000]);
    const overview = cache.getQueryData<{ titles: { items: Receivable[] } }>([
      ...queryKeys.finance(t),
      'overview',
    ])!;
    expect(overview.titles.items[0]!.outstandingCents).toBe(1500);
  });
  it('quitação marca título como quitado; resposta divergente não altera nada', () => {
    const cache = testQueryClient();
    cache.setQueryData(queryKeys.receivable(t, 'r1'), receivable());
    const full = {
      ...receiptBody,
      amountCents: 2000,
      allocations: [{ receivableId: 'r1', amountCents: 2000, expectedVersion: 3 }],
    };
    applyConfirmedReceipt(cache, t, full, { ...financialResult, amountCents: 1999 });
    expect(cache.getQueryData<Receivable>(queryKeys.receivable(t, 'r1'))!.outstandingCents).toBe(
      2000,
    );
    applyConfirmedReceipt(cache, t, full, { ...financialResult, amountCents: 2000 });
    expect(cache.getQueryData<Receivable>(queryKeys.receivable(t, 'r1'))).toMatchObject({
      outstandingCents: 0,
      status: 'paid',
    });
  });
  it('recarrega agora só o que é do pedido; o resto fica marcado para atualizar depois', async () => {
    const cache = testQueryClient();
    const fetched: string[] = [];
    const unsubscribe: (() => void)[] = [];
    const observe = (key: readonly unknown[], name: string) =>
      unsubscribe.push(
        new QueryObserver(cache, {
          queryKey: key,
          queryFn: async () => {
            fetched.push(name);
            return name;
          },
          staleTime: Infinity,
        }).subscribe(() => {}),
      );
    observe(stateKey, 'state');
    observe(queryKeys.payments(t, 'o1'), 'payments');
    observe(queryKeys.receivable(t, 'r1'), 'title');
    observe([...queryKeys.finance(t), 'overview'], 'overview');
    observe(queryKeys.receivables(t, { limit: 25 }), 'list');
    observe(queryKeys.orderList(t, {}), 'orders');
    await new Promise((r) => setTimeout(r, 0));
    fetched.length = 0;
    await refreshAfterFinanceCommand(cache, t, ['o1', 'c1', 'r1']);
    expect(fetched.sort()).toEqual(['payments', 'state', 'title']);
    expect(cache.getQueryState([...queryKeys.finance(t), 'overview'])?.isInvalidated).toBe(true);
    expect(cache.getQueryState(queryKeys.orderList(t, {}))?.isInvalidated).toBe(true);
    unsubscribe.forEach((u) => u());
    cache.clear();
  });
});
