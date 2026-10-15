import { Link, type Href } from 'expo-router';
import { toApiError } from '@/api/errors';
import { Button, Panel, Skeleton, Text } from '@/ui';
import { useExecutions } from './resolutionApi';
export function FinanceGlance() {
  const list = useExecutions({ pending: 'true' });
  return (
    <Panel
      title="Resoluções financeiras pendentes"
      description="Primeira página oficial; nenhum total financeiro inferido."
    >
      {list.query.isPending ? (
        <Skeleton />
      ) : list.query.isError ? (
        <Text>{toApiError(list.query.error).userMessage}</Text>
      ) : list.items.length ? (
        list.items.slice(0, 5).map((e) => (
          <Link key={e.id} href={`/financeiro/execucoes/${e.id}` as Href} asChild>
            <Button
              label={`${e.kind === 'cancellation' ? 'Cancelamento' : 'Devolução'} · ${e.status} · ${e.orderId}`}
              variant="outline"
            />
          </Link>
        ))
      ) : (
        <Text>Nenhuma pendência nesta página.</Text>
      )}
      <Link href={'/financeiro/execucoes' as Href} asChild>
        <Button label="Consultar todas as páginas" variant="outline" />
      </Link>
    </Panel>
  );
}
