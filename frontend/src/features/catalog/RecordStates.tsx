import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { Screen } from '@/layout/Screen';
import { space } from '@/theme';
import { Alert, Button, EmptyState, Panel, Skeleton } from '@/ui';
import { SearchX } from '@/ui/icons';

/** Carregando um registro: esqueleto com a forma da tela. */
export function RecordLoading({ title }: { title: string }) {
  return (
    <Screen title={title}>
      <Panel>
        <View style={styles.loading} accessibilityLabel="Carregando">
          <Skeleton width="40%" height={20} />
          <Skeleton width="70%" />
          <Skeleton width="55%" />
        </View>
      </Panel>
    </Screen>
  );
}

/**
 * Registro inexistente ou fora do escopo. O backend responde 404 nos dois casos para não
 * confirmar que existe; a tela também não distingue.
 */
export function RecordError({
  title,
  error,
  backHref,
  backLabel,
  onRetry,
}: {
  title: string;
  error: unknown;
  backHref: Href;
  backLabel: string;
  onRetry: () => void;
}) {
  const err = toApiError(error);
  return (
    <Screen title={title}>
      {err.kind === 'notFound' ? (
        <Panel flush>
          <EmptyState
            icon={SearchX}
            title="Cadastro não encontrado"
            description="Ele pode ter sido removido da sua visão ou o endereço está incorreto."
            action={
              <Link href={backHref} asChild>
                <Button label={backLabel} variant="strong" />
              </Link>
            }
          />
        </Panel>
      ) : (
        <Alert
          tone="danger"
          title="Não foi possível carregar"
          action={<Button label="Tentar de novo" size="sm" variant="outline" onPress={onRetry} />}
        >
          {err.userMessage}
        </Alert>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ loading: { gap: space[3], paddingTop: space[4] } });
