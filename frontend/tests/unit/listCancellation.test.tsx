import { render, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { createApiClient, type ApiClient } from '@/api/client';
import { useOrderList } from '@/features/orders/api';
import { useReplenishment } from '@/features/inventory/api';
import { testQueryClient } from '../support/testQueryClient';

let mockApi: ApiClient;
jest.mock('@/session/SessionContext', () => ({
  useTenantApi: () => ({ api: mockApi, tenantId: 't1', header: { 'X-Tenant-Id': 't1' } }),
}));

function Orders() {
  useOrderList({ direction: 'desc' });
  return null;
}
function Replenishment() {
  useReplenishment({ q: '', status: 'active', sort: 'shortfall' });
  return null;
}

it.each([
  { name: 'orders', Probe: Orders },
  { name: 'replenishment', Probe: Replenishment },
])('aborts the pending $name HTTP read when its screen unmounts', async ({ Probe }) => {
  const signals: AbortSignal[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    if (!(input instanceof Request)) throw new Error('Expected typed HTTP Request');
    const signal = input.signal;
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
  mockApi = createApiClient({
    baseUrl: 'http://api.test',
    tenantId: 't1',
    getIdToken: async () => 'token',
    onSessionExpired: jest.fn(),
    fetch,
  });
  const client = testQueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signals).toHaveLength(1));
  expect(signals[0]!.aborted).toBe(false);
  await view.unmount();
  await waitFor(() => expect(signals[0]!.aborted).toBe(true));
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
  client.clear();
});
