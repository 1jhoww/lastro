import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCategoryLookup } from '@/features/categories/api';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { ProductForm } from '@/features/products/ProductForm';
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
  const router = useRouter();
  const toast = useToast();
  const product = useProduct(id);
  const categories = useCategoryLookup();
  const update = useUpdateProduct(id);

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
  const p = product.data;

  return (
    <Screen title="Editar produto" description={`${p.name}, ${p.sku}`}>
      <ProductForm
        key={p.version}
        defaultValues={productToForm(p)}
        categories={categories.data ?? []}
        editing
        submitLabel="Salvar alterações"
        submitting={update.isPending}
        error={update.error}
        onCancel={() => router.back()}
        onReload={async () => {
          update.reset();
          await product.refetch();
        }}
        onSubmit={(values) => {
          const body = formToUpdate(values, p);
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
