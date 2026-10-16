import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { GenerationResult } from '@/api/types';
import { FilterTabs } from '@/features/finance/FinanceParts';
import {
  useCharges,
  useCompanies,
  usePlatformApi,
  type ChargeFilter,
} from '@/features/platform/api';
import { ManualChargeDialog } from '@/features/platform/ChargeDialogs';
import { ChargeList } from '@/features/platform/ChargeList';
import { PlatformHeader } from '@/features/platform/PlatformHeader';
import { LoadError, LoadingRows } from '@/features/platform/PlatformParts';
import { usePlatformMutation } from '@/features/platform/platformQuery';
import { space } from '@/theme';
import { Alert, Button, ConfirmDialog, EmptyState, Panel } from '@/ui';
import { Banknote, Plus, RefreshCw } from '@/ui/icons';

const tabs: { value: ChargeFilter; label: string }[] = [
  { value: 'open', label: 'Em aberto' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'due_soon', label: 'Vencem em breve' },
  { value: 'paid', label: 'Pagas' },
  { value: 'canceled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
];

/**
 * Cobranças acompanhadas manualmente (sem gateway). A geração automática roda todo dia pelo
 * agendador; "Gerar agora" aplica a mesma regra idempotente e nunca duplica um mês.
 */
export default function PlatformCharges() {
  const { api } = usePlatformApi();
  const [filter, setFilter] = useState<ChargeFilter>('open');
  const [manual, setManual] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generated, setGenerated] = useState<GenerationResult | null>(null);
  const charges = useCharges(filter);
  const companies = useCompanies();
  const names = new Map((companies.data?.items ?? []).map((c) => [c.id, c.name]));
  const items = charges.data?.pages.flatMap((p) => p.items) ?? [];
  const generate = usePlatformMutation(() => unwrap(api.POST('/api/v1/admin/charges/generate')), {
    onSuccess: (result) => {
      setGenerated(result);
      setConfirmGenerate(false);
    },
  });

  return (
    <>
      <PlatformHeader
        title="Cobranças"
        description="Pagamentos são registrados aqui depois de recebidos. Atraso gera alerta, nunca bloqueio automático."
        action={
          <View style={styles.actions}>
            <Button
              label="Gerar agora"
              icon={RefreshCw}
              variant="outline"
              onPress={() => setConfirmGenerate(true)}
            />
            <Button
              label="Nova cobrança"
              icon={Plus}
              variant="strong"
              disabled={!companies.data}
              onPress={() => setManual(true)}
            />
          </View>
        }
      />
      {generated ? (
        <Alert
          tone={generated.failed ? 'warning' : 'success'}
          title={
            generated.created
              ? `${generated.created} ${generated.created === 1 ? 'cobrança gerada' : 'cobranças geradas'}`
              : 'Nenhuma cobrança nova a gerar hoje'
          }
          action={
            <Button label="Fechar" size="sm" variant="ghost" onPress={() => setGenerated(null)} />
          }
        >
          {`${generated.examined} assinatura(s) ativa(s) conferida(s); ${generated.existing} cobrança(s) já existiam.${
            generated.failed
              ? ` ${generated.failed} falharam e serão tentadas de novo na próxima execução.`
              : ''
          }`}
        </Alert>
      ) : null}
      <FilterTabs<ChargeFilter>
        label="Situação"
        value={filter}
        onChange={setFilter}
        options={tabs}
      />
      {charges.isError ? (
        <LoadError
          title="Não foi possível carregar as cobranças"
          error={charges.error}
          onRetry={() => charges.refetch()}
        />
      ) : null}
      <Panel flush>
        {charges.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Banknote}
            title="Nenhuma cobrança nesta situação"
            description="Cobranças são geradas até 10 dias antes de cada vencimento das assinaturas ativas."
          />
        ) : (
          <ChargeList
            charges={items}
            companyName={(id) => names.get(id) ?? `Empresa ${id.slice(0, 8)}`}
          />
        )}
        {charges.hasNextPage ? (
          <View style={styles.more}>
            <Button
              label="Carregar mais"
              size="sm"
              variant="outline"
              loading={charges.isFetchingNextPage}
              onPress={() => charges.fetchNextPage()}
            />
          </View>
        ) : null}
      </Panel>
      <ConfirmDialog
        visible={confirmGenerate}
        title="Gerar cobranças agora?"
        description="Cria as cobranças que já deveriam existir hoje para as assinaturas ativas. Meses já cobrados não são duplicados."
        confirmLabel="Gerar cobranças"
        tone="strong"
        loading={generate.isPending}
        onCancel={() => {
          setConfirmGenerate(false);
          generate.reset();
        }}
        onConfirm={() => generate.mutate(undefined)}
      >
        {generate.isError ? (
          <Alert tone="danger" title="Geração não concluída">
            {toApiError(generate.error).userMessage}
          </Alert>
        ) : null}
      </ConfirmDialog>
      {manual && companies.data ? (
        <ManualChargeDialog companies={companies.data.items} onClose={() => setManual(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  more: { padding: space[4], alignItems: 'flex-start' },
});
