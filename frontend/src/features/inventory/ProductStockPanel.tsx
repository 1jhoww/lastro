import { Link, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { useSession } from '@/session/SessionContext';
import { color, space } from '@/theme';
import { Alert, Button, Panel, Skeleton, Text } from '@/ui';
import { ListClock, Plus } from '@/ui/icons';
import { useInventoryItem } from './api';
import { BalanceFigures, qty } from './StockParts';
import { isAdminStock } from './stock';

/**
 * Estoque na ficha do produto. Usa a mesma consulta (e cache) da tela de estoque: uma
 * movimentação registrada lá aparece aqui sem nova busca, e vice-versa. O saldo exibido é o
 * que o perfil pode ver; a versão do estoque fica separada da versão do cadastro.
 */
export function ProductStockPanel({ productId }: { productId: string }) {
  const { permissions } = useSession();
  const manage = permissions.includes('inventory:manage');
  const canRead = manage || permissions.includes('inventory:available:read');
  const item = useInventoryItem(productId, canRead);
  if (!canRead) return null;

  return (
    <Panel
      title="Estoque"
      action={
        <Link href={`/estoque/${productId}` as Href} asChild>
          <Button label="Abrir estoque" size="sm" variant="outline" />
        </Link>
      }
    >
      {item.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando estoque">
          <Skeleton width="50%" height={20} />
          <Skeleton width="70%" />
        </View>
      ) : item.isError ? (
        <Alert
          tone="danger"
          title="Saldo indisponível"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => item.refetch()}
            />
          }
        >
          {toApiError(item.error).userMessage}
        </Alert>
      ) : item.data && isAdminStock(item.data) ? (
        <View style={styles.body}>
          <BalanceFigures stock={item.data} />
          {manage ? (
            <View style={styles.actions}>
              <Link href={`/estoque/entrada?produto=${productId}` as Href} asChild>
                <Button label="Registrar entrada" icon={Plus} size="sm" variant="strong" />
              </Link>
              <Link href={`/estoque/movimentacoes?produto=${productId}` as Href} asChild>
                <Button label="Movimentações" icon={ListClock} size="sm" variant="outline" />
              </Link>
            </View>
          ) : null}
        </View>
      ) : item.data ? (
        <View style={styles.body}>
          <Text variant="small" color={color.textSecondary}>
            Disponível para vender
          </Text>
          <Text variant="figureLarge">{qty(item.data.available, item.data.unit)}</Text>
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  body: { gap: space[3], paddingTop: space[1] },
  actions: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
});
