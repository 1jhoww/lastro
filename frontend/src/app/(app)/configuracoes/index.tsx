import { Building, CalendarClock, Store, UserPlus } from '@/ui/icons';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { ListRow, Panel } from '@/ui';

/**
 * A assinatura não aparece aqui: o backend não expõe plano, vagas ou situação de cobrança aos
 * usuários da empresa. Isso é administrado pela Hepta na área da plataforma.
 */
export default function Settings() {
  const { permissions, membership } = useSession();
  // Só aparece o que a empresa contratou: nada aqui lembra um recurso fora do plano.
  const features = membership?.plan.features ?? [];
  const invites = features.includes('users.invite');
  const manageUsers = permissions.includes('users:manage');
  const admin = permissions.includes('tenant:update');

  return (
    <Screen title="Configurações" description={admin ? 'Empresa e equipe.' : 'Dados da empresa.'}>
      <Panel flush>
        <ListRow
          icon={Building}
          title="Empresa"
          description={
            features.includes('branding.custom')
              ? 'Nome, logotipo e fuso horário da empresa.'
              : 'Nome e fuso horário da empresa.'
          }
          href="/configuracoes/empresa"
          last={!manageUsers && !admin}
        />
        {manageUsers ? (
          <ListRow
            icon={UserPlus}
            title={invites ? 'Usuários e convites' : 'Usuários'}
            description={
              !invites
                ? 'Pessoas com acesso à empresa.'
                : features.includes('commercial.sellers')
                  ? 'Convide administradores e vendedores. Cada convite ocupa uma vaga do plano.'
                  : 'Convide administradores. Cada convite ocupa uma vaga do plano.'
            }
            href="/configuracoes/usuarios"
          />
        ) : null}
        {admin ? (
          <ListRow
            icon={CalendarClock}
            title="Condições de pagamento"
            description="Cadastre prazos uma vez e escolha no pedido."
            href="/financeiro/configuracoes"
          />
        ) : null}
        {permissions.includes('catalog:manage') ? (
          <ListRow
            icon={Store}
            title="Catálogo público"
            description="Publicação e orçamento por WhatsApp."
            href="/configuracoes/catalogo"
            last
          />
        ) : null}
      </Panel>
    </Screen>
  );
}
