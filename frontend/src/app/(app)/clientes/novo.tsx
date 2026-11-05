import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { toApiError } from '@/api/errors';
import { CustomerForm } from '@/features/customers/CustomerForm';
import { useCreateCustomer, useLinkSupplier } from '@/features/customers/api';
import { emptyCustomerForm, formToCreate } from '@/features/customers/form';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { Alert, Button, useToast } from '@/ui';

export default function NewCustomer() {
  const router = useRouter();
  const toast = useToast();
  const { permissions } = useSession();
  const admin = permissions.includes('customers:all:manage');
  const suppliers = permissions.includes('suppliers:manage');
  const { relacionamento } = useLocalSearchParams<{ relacionamento?: string }>();
  const supplierFirst = suppliers && relacionamento === 'fornecedor';
  const create = useCreateCustomer();
  const link = useLinkSupplier();
  const [document, setDocument] = useState('');
  const duplicate =
    suppliers && create.error && toApiError(create.error).code === 'DUPLICATE_DOCUMENT';

  return (
    <Screen
      title={supplierFirst ? 'Novo fornecedor' : 'Novo cliente'}
      description={
        supplierFirst
          ? 'Se a empresa já é cliente, o CPF/CNPJ encontra o cadastro existente.'
          : admin
            ? 'Começa sem responsável; o vendedor é definido depois, na ficha.'
            : 'O cliente entra na sua carteira.'
      }
    >
      {duplicate && document ? (
        <Alert
          tone="warning"
          title="Este CPF/CNPJ já está cadastrado"
          action={
            <Button
              label="Usar o cadastro existente"
              size="sm"
              variant="strong"
              loading={link.isPending}
              onPress={() =>
                link.mutate(document, {
                  onSuccess: (record) => {
                    toast.show('Cadastro marcado como fornecedor');
                    router.replace(`/clientes/${record.id}` as Href);
                  },
                })
              }
            />
          }
        >
          Não é preciso cadastrar de novo: o mesmo registro passa a ser fornecedor.
        </Alert>
      ) : null}
      <CustomerForm
        suppliers={suppliers}
        defaultValues={
          supplierFirst
            ? { ...emptyCustomerForm, isCustomer: false, isSupplier: true }
            : emptyCustomerForm
        }
        submitting={create.isPending}
        error={create.error}
        onCancel={() => router.back()}
        onSubmit={(values) => {
          if (create.isPending) return;
          const body = formToCreate(values);
          setDocument(body.document ?? '');
          create.mutate(body, {
            onSuccess: (customer) => {
              toast.show(values.isCustomer ? 'Cliente cadastrado' : 'Fornecedor cadastrado');
              router.replace(`/clientes/${customer.id}` as Href);
            },
          });
        }}
      />
    </Screen>
  );
}
