import { createQueryClient } from '@/api/queryClient';

/** Mesmas regras do app, sem timers de coleta que manteriam o Jest vivo após os testes. */
export function testQueryClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...defaults.queries, gcTime: Infinity },
    mutations: { ...defaults.mutations, gcTime: Infinity },
  });
  return client;
}
