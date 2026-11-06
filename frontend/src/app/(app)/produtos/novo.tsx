import { useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { FormActions } from '@/features/catalog/FormParts';
import { useCategoryLookup } from '@/features/categories/api';
import { CommandError, Stack, SummaryRow } from '@/features/management/Parts';
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
import { formatCents } from '@/lib/money';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { Alert, Button, Panel, Text, useToast } from '@/ui';

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
  // Set once the product exists and its cost failed: as with the image, the form is not offered
  // again, so retrying can never create a duplicate product.
  const [costRetry, setCostRetry] = useState<{
    product: Product;
    cents: number;
    error: unknown;
  } | null>(null);
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  // Set once the product exists and its image failed: the form is not offered again, so a
  // second "Salvar" can never create a duplicate product.
  const [saved, setSaved] = useState<{ product: Product; error: unknown } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const open = (product: Product) => router.replace(`/produtos/${product.id}` as Href);
  const sendCost = async (product: Product, cents: number, retry = false) => {
    try {
      await saveCost.mutateAsync({
        productId: product.id,
        expectedVersion: 0,
        referenceCostCents: cents,
        retry,
      });
      return true;
    } catch (error) {
      setCostRetry({ product, cents, error });
      return false;
    }
  };
  const send = async (product: Product, image: PickedImage) => {
    setUploading(true);
    setPickError(null);
    try {
      const next = await uploadProductImage(api, tenantId, product.id, image, product.version);
      store(next);
      toast.show('Produto cadastrado com imagem');
      open(next);
    } catch (error) {
      // O produto já existe: a falha na imagem não desfaz o cadastro e fica visível aqui.
      setSaved({ product, error });
    } finally {
      setUploading(false);
    }
  };

  // A imagem escolhida fica guardada e segue depois do custo, resolvido ou dispensado.
  const afterCost = async (product: Product, message: string) => {
    setCostRetry(null);
    if (!pendingImage) {
      toast.show(message);
      return open(product);
    }
    await send(product, pendingImage);
  };

  if (costRetry)
    return (
      <Screen title="Novo produto">
        <Alert tone="success" title={`Produto "${costRetry.product.name}" cadastrado`}>
          {`SKU ${costRetry.product.sku}. Os dados estão salvos; falta só o custo.`}
        </Alert>
        <Panel title="Custo de referência">
          <Stack>
            <CommandError error={costRetry.error} title="Custo não salvo" />
            <SummaryRow label="Custo informado" value={formatCents(costRetry.cents)} />
            {pendingImage ? (
              <Text variant="small">A imagem escolhida será enviada em seguida.</Text>
            ) : null}
            <FormActions>
              <Button
                label="Continuar sem custo"
                variant="ghost"
                disabled={saveCost.isPending || uploading}
                onPress={() => void afterCost(costRetry.product, 'Produto cadastrado sem custo')}
              />
              <Button
                label="Tentar novamente"
                variant="strong"
                loading={saveCost.isPending || uploading}
                onPress={async () => {
                  const { product, cents } = costRetry;
                  if (await sendCost(product, cents, true))
                    await afterCost(product, 'Produto cadastrado');
                }}
              />
            </FormActions>
          </Stack>
        </Panel>
      </Screen>
    );

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
              toast.show('Produto cadastrado sem imagem');
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
              const cents = showCost ? values.referenceCostCents : null;
              if (cents !== null && !(await sendCost(product, cents))) return;
              await afterCost(product, 'Produto cadastrado');
            },
          });
        }}
      />
    </Screen>
  );
}
