import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { RecordError, RecordLoading } from '@/features/catalog/RecordStates';
import { CustomerForm } from '@/features/customers/CustomerForm';
import { useCustomer, useUpdateCustomer } from '@/features/customers/api';
import { customerToForm, formToUpdate } from '@/features/customers/form';
import { addressComplete } from '@/features/customers/presentation';
import { Screen } from '@/layout/Screen';
import { useToast } from '@/ui';

export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const customer = useCustomer(id);
  const update = useUpdateCustomer(id);

  if (customer.isPending) return <RecordLoading title="Editar cliente" />;
  if (customer.isError || !customer.data)
    return (
      <RecordError
        title="Editar cliente"
        error={customer.error}
        backHref="/clientes"
        backLabel="Voltar para clientes"
        onRetry={() => customer.refetch()}
      />
    );
  const c = customer.data;

  return (
    <Screen title="Editar cliente" description={c.name}>
      <CustomerForm
        // Nova versão (após conflito e recarga) remonta o formulário com os dados atuais.
        key={c.version}
        defaultValues={customerToForm(c)}
        incompleteAddress={!addressComplete(c.address)}
        submitting={update.isPending}
        error={update.error}
        onCancel={() => router.back()}
        onReload={async () => {
          update.reset();
          await customer.refetch();
        }}
        onSubmit={(values) => {
          if (update.isPending) return;
          update.mutate(formToUpdate(values, c.version), {
            onSuccess: () => {
              toast.show('Cliente salvo');
              router.replace(`/clientes/${c.id}` as Href);
            },
          });
        }}
      />
    </Screen>
  );
}
