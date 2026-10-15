import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * Lista paginada por cursor, como o backend entrega (sem total nem offset). As páginas são
 * acumuladas em "Carregar mais"; mudar filtros muda a chave e recomeça do início.
 */
export function useCursorList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
  enabled = true,
) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { query, items };
}

/** Parâmetros comuns de listagem. `q` só é aceito com ordenação por nome crescente. */
export function listParams(f: { q?: string; status?: string }, limit = 50) {
  const q = f.q?.trim();
  return {
    limit: String(limit),
    sort: 'name' as const,
    direction: 'asc' as const,
    ...(f.status ? { status: f.status as 'active' | 'inactive' | 'all' } : {}),
    ...(q ? { q: q.slice(0, 80) } : {}),
  };
}
