import { router, type Href } from 'expo-router';
import { unwrap } from '@/api/client';
import { usePlanCatalog, usePlatformApi } from '@/features/platform/api';
import {
  CustomPlanForm,
  type CustomPlanValues,
} from '@/features/platform/customPlans/CustomPlanForm';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { BackLink, LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { usePlatformMutation } from '@/features/platform/platformQuery';
import { useIntentKey } from '@/lib/idempotency';
import { useToast } from '@/ui';

const empty: CustomPlanValues = {
  name: '',
  description: '',
  monthlyPriceCents: 0,
  userLimit: 2,
  features: [],
  sourcePlanCode: null,
};

/** A chave de idempotência dura enquanto a oferta não muda: repetir não cria segundo plano. */
export default function NewCustomPlan() {
  const { api } = usePlatformApi();
  const catalog = usePlanCatalog();
  const toast = useToast();
  const intent = useIntentKey();
  const create = usePlatformMutation(
    (values: CustomPlanValues) =>
      unwrap(
        api.POST('/api/v1/admin/custom-plans', {
          params: { header: { 'Idempotency-Key': intent.current() } },
          body: values,
        }),
      ),
    {
      onSuccess: (plan) => {
        intent.reset();
        toast.show('Plano personalizado criado');
        router.replace(`/plataforma/planos/${plan.id}` as Href);
      },
    },
  );
  return (
    <>
      <BackLink href="/plataforma/planos" label="Planos personalizados" />
      <PlatformHeader
        title="Novo plano personalizado"
        description="Defina a oferta. A empresa só é afetada quando você vincular o plano a ela."
      />
      {catalog.isPending ? <LoadingRows rows={5} /> : null}
      {catalog.isError ? (
        <LoadError
          title="Não foi possível carregar os recursos"
          error={catalog.error}
          onRetry={() => catalog.refetch()}
        />
      ) : null}
      {catalog.data ? (
        <CustomPlanForm
          catalog={catalog.data}
          initial={empty}
          allowModel
          submitLabel="Criar plano"
          pending={create.isPending}
          error={create.error}
          onChange={intent.reset}
          onSubmit={(values) => create.mutate(values)}
          onCancel={() => router.replace('/plataforma/planos' as Href)}
        />
      ) : null}
    </>
  );
}
