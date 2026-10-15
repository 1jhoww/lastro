import { useRouter, type Href } from 'expo-router';
import { CustomerForm } from '@/features/customers/CustomerForm';
import { useCreateCustomer } from '@/features/customers/api';
import { emptyCustomerForm, formToCreate } from '@/features/customers/form';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { useToast } from '@/ui';

export default function NewCustomer() {
  const router = useRouter();
  const toast = useToast();
  const { permissions } = useSession();
  const admin = permissions.includes('customers:all:manage');
  const create = useCreateCustomer();

  return (
    <Screen
      title="Novo cliente"
      description={
        admin
          ? 'Começa sem responsável. Você define o vendedor depois, no cadastro.'
          : 'O cliente entra na sua carteira.'
      }
    >
      <CustomerForm
        defaultValues={emptyCustomerForm}
        submitLabel="Cadastrar cliente"
        submitting={create.isPending}
        error={create.error}
        onCancel={() => router.back()}
        onSubmit={(values) =>
          create.mutate(formToCreate(values), {
            onSuccess: (customer) => {
              toast.show('Cliente cadastrado');
              router.replace(`/clientes/${customer.id}` as Href);
            },
          })
        }
      />
    </Screen>
  );
}
