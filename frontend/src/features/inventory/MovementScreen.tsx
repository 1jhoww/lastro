import { useState } from 'react';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Button, EmptyState, Panel, Skeleton, Text } from '@/ui';
import { Package, SearchX } from '@/ui/icons';
import { useInventoryItem } from './api';
import type { MovementKind } from '@/lib/intent';
import { MovementForm } from './MovementForm';
import { ProductPicker } from './ProductPicker';
import { BalanceFigures } from './StockParts';
import { isAdminStock } from './stock';

const titles: Record<MovementKind, { title: string; description: string }> = {
  entry: {
    title: 'Registrar entrada',
    description: 'Mercadoria que chegou: soma ao saldo físico do produto.',
  },
  adjustment: {
    title: 'Ajustar saldo',
    description: 'Correção autorizada do saldo físico, com motivo registrado no histórico.',
  },
};

/** Rota de entrada ou ajuste. `?produto=ID` já abre com o produto escolhido. */
export function MovementScreen({ kind }: { kind: MovementKind }) {
  return (
    <RequirePermission title={titles[kind].title} anyOf={['inventory:manage']}>
      <MovementContent kind={kind} />
    </RequirePermission>
  );
}

function MovementContent({ kind }: { kind: MovementKind }) {
  const params = useLocalSearchParams<{ produto?: string }>();
  const productId =
    typeof params.produto === 'string' && params.produto ? params.produto : undefined;
  const [picking, setPicking] = useState(false);
  const compact = useLayoutSize() === 'compact';
  const item = useInventoryItem(productId);
  const stock = item.data && isAdminStock(item.data) ? item.data : null;

  const choose = (id: string) => {
    setPicking(false);
    router.setParams({ produto: id });
  };

  return (
    <Screen title={titles[kind].title} description={titles[kind].description}>
      <Panel
        title="Produto"
        action={
          productId ? (
            <Button
              label="Trocar produto"
              size="sm"
              variant="outline"
              onPress={() => setPicking(true)}
            />
          ) : null
        }
      >
        {!productId ? (
          <EmptyState
            size="compact"
            icon={Package}
            title="Escolha o produto"
            description="A unidade do produto define se a quantidade aceita casas decimais."
            action={
              <Button label="Escolher produto" variant="strong" onPress={() => setPicking(true)} />
            }
          />
        ) : item.isPending ? (
          <View style={styles.loading} accessibilityLabel="Carregando">
            <Skeleton width="50%" height={18} />
            <Skeleton width="80%" />
          </View>
        ) : item.isError ? (
          toApiError(item.error).kind === 'notFound' ? (
            <EmptyState
              size="compact"
              icon={SearchX}
              title="Produto não encontrado"
              description="Ele pode ter sido removido ou o endereço está incorreto."
              action={
                <Button label="Escolher outro" variant="strong" onPress={() => setPicking(true)} />
              }
            />
          ) : (
            <Alert
              tone="danger"
              title="Não foi possível carregar o saldo"
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
          )
        ) : stock ? (
          <View style={styles.product}>
            <View>
              <Text variant="bodyStrong">{stock.name}</Text>
              <Text variant="small" color={color.textSecondary}>
                {`${stock.sku} · unidade ${stock.unit}${stock.status === 'inactive' ? ' · produto inativo' : ''}`}
              </Text>
            </View>
            <BalanceFigures stock={stock} />
          </View>
        ) : null}
      </Panel>

      {stock ? (
        // Trocar de produto remonta o formulário: unidade, versão e intenção são do produto novo.
        <MovementForm key={stock.productId} kind={kind} stock={stock} />
      ) : (
        <View style={[styles.back, compact && styles.backCompact]}>
          <Link href={'/estoque' as Href} asChild>
            <Button label="Voltar para o estoque" variant="ghost" />
          </Link>
        </View>
      )}

      <ProductPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => choose(p.productId)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2], paddingTop: space[2] },
  product: { gap: space[4], paddingTop: space[1] },
  back: { flexDirection: 'row', justifyContent: 'flex-end' },
  backCompact: { justifyContent: 'center' },
});
