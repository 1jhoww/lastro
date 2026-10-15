import { useState } from 'react';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Product } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { DetailColumns, Fact, Facts } from '@/features/catalog/DetailParts';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { ProductStockPanel } from '@/features/inventory/ProductStockPanel';
import { ProductImagePanel } from '@/features/products/ProductImagePanel';
import { useProduct, useSetProductStatus } from '@/features/products/api';
import { Screen } from '@/layout/Screen';
import { formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { formatQuantity, fromApiQuantity, unitLabel } from '@/lib/quantity';
import { useSession } from '@/session/SessionContext';
import { color, space, useLayoutSize } from '@/theme';
import { Alert, Badge, Button, ConfirmDialog, Panel, Text, useToast } from '@/ui';
import { Archive, Pencil, RotateCcw } from '@/ui/icons';
import { units } from '@/features/products/form';

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);
  if (product.isPending) return <RecordLoading title="Produto" />;
  if (product.isError || !product.data)
    return (
      <RecordError
        title="Produto"
        error={product.error}
        backHref="/produtos"
        backLabel="Voltar para produtos"
        onRetry={() => product.refetch()}
      />
    );
  return <ProductView product={product.data} />;
}

function ProductView({ product: p }: { product: Product }) {
  const { permissions } = useSession();
  const manage = permissions.includes('products:manage');
  const compact = useLayoutSize() === 'compact';
  const categories = useCategoryLookup();
  const setStatus = useSetProductStatus(p.id);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const active = p.status === 'active';
  const category = p.categoryId ? categories.data?.find((c) => c.id === p.categoryId) : null;
  const unit = units.find((u) => u.value === p.unit);

  return (
    <Screen
      title={p.name}
      description={p.sku}
      actions={
        manage ? (
          <>
            <Link href={`/produtos/${p.id}/editar` as Href} asChild>
              <Button label="Editar" icon={Pencil} variant="outline" fullWidth={compact} />
            </Link>
            <Button
              label={active ? 'Desativar' : 'Reativar'}
              icon={active ? Archive : RotateCcw}
              variant={active ? 'ghost' : 'strong'}
              fullWidth={compact}
              onPress={() => setConfirm(true)}
            />
          </>
        ) : null
      }
    >
      {!active ? (
        <Alert tone="warning" title="Produto inativo">
          Vendedores não o veem e ele não entra em novos pedidos. Saldo e histórico de estoque ficam
          preservados.
        </Alert>
      ) : null}
      {setStatus.isError ? (
        <Alert tone="danger" title="Situação não alterada">
          {toApiError(setStatus.error).code === 'CONFLICT'
            ? 'O produto mudou enquanto você decidia. A versão atual foi carregada; tente de novo.'
            : toApiError(setStatus.error).userMessage}
        </Alert>
      ) : null}

      <DetailColumns
        main={
          <>
            <Panel title="Venda">
              <Facts>
                <Fact
                  label="Preço de tabela"
                  value={
                    <Text variant="figureLarge">
                      {formatCents(p.priceCents)}
                      <Text variant="body" color={color.textSecondary}>
                        {` por ${unitLabel[p.unit]}`}
                      </Text>
                    </Text>
                  }
                />
                <Fact label="Unidade" value={unit?.label ?? p.unit} />
                <Fact
                  label="Categoria"
                  value={
                    category
                      ? category.status === 'active'
                        ? category.name
                        : `${category.name} (inativa)`
                      : p.categoryId
                        ? ''
                        : 'Sem categoria'
                  }
                />
                <Fact
                  label="Quantidades"
                  value={
                    p.quantityPrecision
                      ? `Até ${p.quantityPrecision} casas decimais`
                      : 'Somente inteiras'
                  }
                />
              </Facts>
            </Panel>
            <Panel title="Descrição">
              <Text
                variant="body"
                color={p.description ? color.text : color.textSecondary}
                selectable
              >
                {p.description || 'Sem descrição.'}
              </Text>
            </Panel>
          </>
        }
        side={
          <>
            <ProductImagePanel product={p} canManage={manage} />
            <ProductStockPanel productId={p.id} />
            <Panel title="Registro">
              <View style={styles.facts}>
                <Fact
                  label="Situação"
                  value={
                    <Badge
                      label={active ? 'Ativo' : 'Inativo'}
                      tone={active ? 'success' : 'neutral'}
                    />
                  }
                />
                {manage ? (
                  <Fact
                    label="Catálogo público"
                    value={
                      p.catalogVisible ? 'Visível quando o catálogo estiver ativado' : 'Oculto'
                    }
                  />
                ) : null}
                {manage ? (
                  <Fact
                    label="Estoque mínimo"
                    value={formatQuantity(fromApiQuantity(p.minimumStock), p.unit)}
                  />
                ) : null}
                <Fact label="Cadastrado em" value={formatDate(p.createdAt)} />
                <Fact label="Última alteração" value={formatDate(p.updatedAt)} />
              </View>
            </Panel>
          </>
        }
      />

      <ConfirmDialog
        visible={confirm}
        title={active ? 'Desativar produto?' : 'Reativar produto?'}
        description={
          active
            ? 'O produto some para vendedores e do catálogo, e não entra em novos pedidos. Saldo, histórico e pedidos antigos ficam preservados.'
            : 'O produto volta a aparecer para vendedores e pode entrar em pedidos.'
        }
        confirmLabel={active ? 'Desativar produto' : 'Reativar produto'}
        tone={active ? 'danger' : 'strong'}
        loading={setStatus.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          setStatus.mutate(
            { active: !active, expectedVersion: p.version },
            {
              onSuccess: () => toast.show(active ? 'Produto desativado' : 'Produto reativado'),
              onSettled: () => setConfirm(false),
            },
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ facts: { gap: space[4], paddingTop: space[1] } });
