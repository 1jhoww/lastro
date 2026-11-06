import { useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useCategoryLookup } from '@/features/categories/api';
import { useSaveReferenceCost } from '@/features/management/api';
import { canEditProductCost } from '@/features/management/presentation';
import { RequirePermission } from '@/features/session/RequirePermission';
import { ProductForm } from '@/features/products/ProductForm';
import {
  ImageUploadFailure,
  PendingImagePicker,
  pickImage,
} from '@/features/products/ProductImagePanel';
import {
  uploadProductImage,
  useCreateProduct,
  useStoreProduct,
  type PickedImage,
} from '@/features/products/api';
import { emptyProductForm, formToCreate } from '@/features/products/form';
import type { Product } from '@/api/types';
import { Screen } from '@/layout/Screen';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { Alert, Panel, useToast } from '@/ui';

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
  const { permissions } = useSession();
  const showCost = canEditProductCost(permissions);
  const categories = useCategoryLookup();
  const create = useCreateProduct();
  const store = useStoreProduct();
  const saveCost = useSaveReferenceCost();
  // O produto já existe quando o custo é enviado: a falha não desfaz o cadastro nem o repete.
  const costFailed = useRef(false);
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  // Set once the product exists and its image failed: the form is not offered again, so a
  // second "Salvar" can never create a duplicate product.
  const [saved, setSaved] = useState<{ product: Product; error: unknown } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const open = (product: Product) => router.replace(`/produtos/${product.id}` as Href);
  const finish = (message: string) =>
    costFailed.current
      ? toast.show('Produto cadastrado, mas o custo não foi salvo. Informe-o na ficha.', 'danger')
      : toast.show(message);
  const sendCost = async (product: Product, cents: number | null) => {
    if (!showCost || cents === null) return;
    try {
      await saveCost.mutateAsync({
        productId: product.id,
        expectedVersion: 0,
        referenceCostCents: cents,
      });
    } catch {
      costFailed.current = true;
    }
  };
  const send = async (product: Product, image: PickedImage) => {
    setUploading(true);
    setPickError(null);
    try {
      const next = await uploadProductImage(api, tenantId, product.id, image, product.version);
      store(next);
      finish('Produto cadastrado com imagem');
      open(next);
    } catch (error) {
      // O produto já existe: a falha na imagem não desfaz o cadastro e fica visível aqui.
      setSaved({ product, error });
    } finally {
      setUploading(false);
    }
  };

  if (saved && pendingImage)
    return (
      <Screen title="Novo produto">
        <Alert tone="success" title={`Produto "${saved.product.name}" cadastrado`}>
          {`SKU ${saved.product.sku}. Os dados estão salvos; falta só a imagem.`}
        </Alert>
        <Panel title="Imagem">
          <ImageUploadFailure
            image={pendingImage}
            error={saved.error}
            busy={uploading}
            onRetry={() => void send(saved.product, pendingImage)}
            onChooseOther={async () => {
              const picked = await pickImage();
              if (!picked) return;
              if ('error' in picked) {
                setPickError(picked.error);
                return;
              }
              setPendingImage(picked);
              await send(saved.product, picked);
            }}
            onSkip={() => {
              finish('Produto cadastrado sem imagem');
              open(saved.product);
            }}
          />
          {pickError ? (
            <Alert tone="danger" title="Imagem não aceita">
              {pickError}
            </Alert>
          ) : null}
        </Panel>
      </Screen>
    );

  return (
    <Screen
      title="Novo produto"
      description="O estoque começa zerado. Entradas são registradas no Estoque."
    >
      <ProductForm
        defaultValues={emptyProductForm}
        categories={categories.data ?? []}
        editing={false}
        showCost={showCost}
        image={
          <PendingImagePicker
            value={pendingImage}
            onChange={setPendingImage}
            disabled={create.isPending || uploading}
          />
        }
        submitting={create.isPending || saveCost.isPending || uploading}
        error={create.error}
        onCancel={() => router.back()}
        onSubmit={(values) => {
          if (create.isPending || saveCost.isPending || uploading) return;
          create.mutate(formToCreate(values), {
            onSuccess: async (product) => {
              await sendCost(product, values.referenceCostCents);
              if (!pendingImage) {
                finish('Produto cadastrado');
                return open(product);
              }
              await send(product, pendingImage);
            },
          });
        }}
      />
    </Screen>
  );
}
