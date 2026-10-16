import { useState } from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { Product } from '@/api/types';
import { useCategoryLookup } from '@/features/categories/api';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { ProductForm } from '@/features/products/ProductForm';
import { ProductImageEditor } from '@/features/products/ProductImagePanel';
import { useProduct, useUpdateProduct } from '@/features/products/api';
import { formToUpdate, productToForm } from '@/features/products/form';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
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
  const product = useProduct(id);

  if (product.isPending) return <RecordLoading title="Editar produto" />;
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
  return <EditForm product={product.data} onRefetch={() => product.refetch()} />;
}

/**
 * A versão-base é a do momento em que o formulário abriu. Trocar a imagem aqui avança essa
 * base (é uma alteração desta mesma tela) sem remontar o formulário nem perder o que foi
 * digitado; mudança feita por outra pessoa continua caindo em conflito ao salvar.
 */
function EditForm({
  product: p,
  onRefetch,
}: {
  product: Product;
  onRefetch: () => Promise<{ data?: Product }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const categories = useCategoryLookup();
  const update = useUpdateProduct(p.id);
  const [base, setBase] = useState(p);
  const [formKey, setFormKey] = useState(0);

  return (
    <Screen title="Editar produto" description={`${base.name} · ${base.sku}`}>
      <ProductForm
        key={formKey}
        defaultValues={productToForm(base)}
        categories={categories.data ?? []}
        editing
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
        submitting={update.isPending}
        error={update.error}
        onCancel={() => router.back()}
        onReload={async () => {
          update.reset();
          const fresh = (await onRefetch()).data;
          if (fresh) setBase(fresh);
          setFormKey((k) => k + 1);
        }}
        onSubmit={(values) => {
          if (update.isPending) return;
          const body = formToUpdate(values, base);
          if (Object.keys(body).length === 1) {
            router.replace(`/produtos/${p.id}` as Href);
            return;
          }
          update.mutate(body, {
            onSuccess: () => {
              toast.show('Produto salvo');
              router.replace(`/produtos/${p.id}` as Href);
            },
          });
        }}
      />
    </Screen>
  );
}
