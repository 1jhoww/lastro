import { useRouter, type Href } from 'expo-router';
import { useCategoryLookup } from '@/features/categories/api';
import { RequirePermission } from '@/features/session/RequirePermission';
import { ProductForm } from '@/features/products/ProductForm';
import { useCreateProduct } from '@/features/products/api';
import { emptyProductForm, formToCreate } from '@/features/products/form';
import { Screen } from '@/layout/Screen';
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
  const categories = useCategoryLookup();
  const create = useCreateProduct();

  return (
    <Screen
      title="Novo produto"
      description="O estoque começa zerado. Entradas são registradas no Estoque."
    >
      <ProductForm
        defaultValues={emptyProductForm}
        categories={categories.data ?? []}
        editing={false}
        submitLabel="Cadastrar produto"
        submitting={create.isPending}
        error={create.error}
        onCancel={() => router.back()}
        onSubmit={(values) =>
          create.mutate(formToCreate(values), {
            onSuccess: (product) => {
              toast.show('Produto cadastrado');
              router.replace(`/produtos/${product.id}` as Href);
            },
          })
        }
      />
    </Screen>
  );
}
