import { useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useCategoryLookup } from '@/features/categories/api';
import { RequirePermission } from '@/features/session/RequirePermission';
import { ProductForm } from '@/features/products/ProductForm';
import { PendingImagePicker, uploadMessage } from '@/features/products/ProductImagePanel';
import {
  uploadProductImage,
  useCreateProduct,
  useStoreProduct,
  type PickedImage,
} from '@/features/products/api';
import { emptyProductForm, formToCreate } from '@/features/products/form';
import { Screen } from '@/layout/Screen';
import { useTenantApi } from '@/session/SessionContext';
import { useToast } from '@/ui';

export default function NewProductRoute() {
  return (
    <RequirePermission title="Novo produto" anyOf={['products:manage']}>
      <NewProduct />
    </RequirePermission>
  );
}

function NewProduct() {
  const router = useRouter();
  const toast = useToast();
  const { api, tenantId } = useTenantApi();
  const categories = useCategoryLookup();
  const create = useCreateProduct();
  const store = useStoreProduct();
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <Screen
      title="Novo produto"
      description="O estoque começa zerado. Entradas são registradas no Estoque."
    >
      <ProductForm
        defaultValues={emptyProductForm}
        categories={categories.data ?? []}
        editing={false}
        image={
          <PendingImagePicker
            value={pendingImage}
            onChange={setPendingImage}
            disabled={create.isPending || uploading}
          />
        }
        submitting={create.isPending || uploading}
        error={create.error}
        onCancel={() => router.back()}
        onSubmit={(values) => {
          if (create.isPending || uploading) return;
          create.mutate(formToCreate(values), {
            onSuccess: async (product) => {
              const open = () => router.replace(`/produtos/${product.id}` as Href);
              if (!pendingImage) {
                toast.show('Produto cadastrado');
                return open();
              }
              // O produto já existe: falha na imagem não desfaz o cadastro, só avisa.
              setUploading(true);
              try {
                store(
                  await uploadProductImage(
                    api,
                    tenantId,
                    product.id,
                    pendingImage,
                    product.version,
                  ),
                );
                toast.show('Produto cadastrado com imagem');
              } catch (e) {
                toast.show(`Produto cadastrado; imagem não enviada. ${uploadMessage(e)}`, 'danger');
              } finally {
                setUploading(false);
              }
              open();
            },
          });
        }}
      />
    </Screen>
  );
}
