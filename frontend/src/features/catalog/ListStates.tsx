import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { toApiError } from '@/api/errors';
import { space } from '@/theme';
import { Alert, Button, Panel, Skeleton } from '@/ui';

type Props = {
  query: Pick<
    UseInfiniteQueryResult,
    | 'isPending'
    | 'isError'
    | 'error'
    | 'refetch'
    | 'hasNextPage'
    | 'fetchNextPage'
    | 'isFetchingNextPage'
  >;
  count: number;
  /** Estado vazio já com o texto certo (sem cadastros x sem resultado para a busca). */
  empty: ReactNode;
  children: ReactNode;
};

/** Painel de lista com os estados de carregamento, erro, vazio e "carregar mais". */
export function ListPanel({ query, count, empty, children }: Props) {
  return (
    <>
      {query.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar a lista"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => query.refetch()}
            />
          }
        >
          {toApiError(query.error).userMessage}
        </Alert>
      ) : null}
      <Panel flush>
        {query.isPending ? (
          <View style={styles.loading} accessibilityLabel="Carregando">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.loadingRow}>
                <Skeleton width="45%" height={16} />
                <Skeleton width="25%" />
              </View>
            ))}
          </View>
        ) : count === 0 && !query.isError ? (
          empty
        ) : (
          children
        )}
      </Panel>
      {query.hasNextPage ? (
        <View style={styles.more}>
          <Button
            label="Carregar mais"
            variant="outline"
            loading={query.isFetchingNextPage}
            onPress={() => query.fetchNextPage()}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { padding: space[5], gap: space[5] },
  loadingRow: { gap: space[2] },
  more: { alignItems: 'center' },
});
