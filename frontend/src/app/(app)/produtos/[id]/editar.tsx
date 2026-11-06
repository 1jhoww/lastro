import { useState } from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { Product, ProductCosts } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { useProductCosts, useSaveReferenceCost } from '@/features/management/api';
import { canEditProductCost } from '@/features/management/presentation';
import { ProductForm } from '@/features/products/ProductForm';
import { ProductImageEditor } from '@/features/products/ProductImagePanel';
import { useProduct, useUpdateProduct } from '@/features/products/api';
import { formToUpdate, productToForm } from '@/features/products/form';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { ApiError } from '@/api/errors';
import { useToast } from '@/ui';

export default function EditProductRoute() {
  return (
    <RequirePermission title="Editar produto" anyOf={['products:manage']}>
      <EditProduct />
    </RequirePermission>
  );
}

function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { permissions } = useSession();
  const showCost = canEditProductCost(permissions);
  const product = useProduct(id);
  const costs = useProductCosts(id, showCost);

  if (product.isPending || (showCost && costs.isPending))
    return <RecordLoading title="Editar produto" />;
  if (product.isError || !product.data)
    return (
      <RecordError
        title="Editar produto"
        error={product.error}
        backHref="/produtos"
        backLabel="Voltar para produtos"
        onRetry={() => product.refetch()}
      />
    );
  return (
    <EditForm
      product={product.data}
      // Sem os custos o cadastro continua editável: só o campo de custo fica de fora.
      cost={showCost ? (costs.data ?? null) : null}
      onRefetch={() => product.refetch()}
      onRefetchCost={() => costs.refetch()}
    />
  );
}

const isConflict = (error: unknown) => error instanceof ApiError && error.code === 'CONFLICT';

/**
 * A versão-base é a do momento em que o formulário abriu. Trocar a imagem aqui avança essa
 * base (é uma alteração desta mesma tela) sem remontar o formulário nem perder o que foi
 * digitado; mudança feita por outra pessoa continua caindo em conflito ao salvar.
 */
function EditForm({
  product: p,
  cost,
  onRefetch,
  onRefetchCost,
}: {
  product: Product;
  cost: ProductCosts | null;
  onRefetch: () => Promise<{ data?: Product }>;
  onRefetchCost: () => Promise<{ data?: ProductCosts }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const categories = useCategoryLookup();
  const update = useUpdateProduct(p.id);
  const saveCost = useSaveReferenceCost();
  const [base, setBase] = useState(p);
  const [costBase, setCostBase] = useState(cost);
  const [costFailure, setCostFailure] = useState<{
    error: unknown;
    productSaved: boolean;
  } | null>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <Screen title="Editar produto" description={`${base.name} · ${base.sku}`}>
      <ProductForm
        key={formKey}
        defaultValues={productToForm(base, costBase?.referenceCostCents ?? null)}
        categories={categories.data ?? []}
        editing
        showCost={costBase !== null}
        averageCostCents={costBase?.averageCostCents ?? null}
        costFailure={costFailure}
        image={
          <ProductImageEditor
            product={p}
            canManage
            expectedVersion={base.version}
            onChanged={(next) =>
              setBase((b) => ({ ...b, image: next.image, version: next.version }))
            }
          />
        }
        submitting={update.isPending || saveCost.isPending}
        error={update.error ?? (costFailure || !isConflict(saveCost.error) ? null : saveCost.error)}
        onCancel={() => router.back()}
        onReload={async () => {
          update.reset();
          saveCost.reset();
          setCostFailure(null);
          const fresh = (await onRefetch()).data;
          if (fresh) setBase(fresh);
          if (costBase) {
            const freshCost = (await onRefetchCost()).data;
            if (freshCost) setCostBase(freshCost);
          }
          setFormKey((k) => k + 1);
        }}
        onSubmit={async (values) => {
          if (update.isPending || saveCost.isPending) return;
          const body = formToUpdate(values, base);
          const productChanged = Object.keys(body).length > 1;
          const costChanged =
            costBase !== null && values.referenceCostCents !== costBase.referenceCostCents;
          try {
            // O produto vai antes: se o custo falhar, salvar de novo reenvia só o custo.
            if (productChanged) setBase(await update.mutateAsync(body));
          } catch {
            return; // O erro fica visível no formulário.
          }
          const productSaved = productChanged || costFailure?.productSaved === true;
          if (costChanged) {
            try {
              setCostBase(
                await saveCost.mutateAsync({
                  productId: p.id,
                  expectedVersion: costBase.version,
                  referenceCostCents: values.referenceCostCents,
                  retry: costFailure !== null,
                }),
              );
            } catch (error) {
              // Conflito pede a versão atual, como no produto; o resto admite nova tentativa.
              setCostFailure(isConflict(error) ? null : { error, productSaved });
              return;
            }
          }
          setCostFailure(null);
          if (productSaved || costChanged) toast.show('Produto salvo');
          router.replace(`/produtos/${p.id}` as Href);
        }}
      />
    </Screen>
  );
}
