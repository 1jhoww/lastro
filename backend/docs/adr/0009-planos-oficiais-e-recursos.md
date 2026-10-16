# Planos oficiais definidos pelo sistema e recursos por plano

Os planos deixam de ser cadastrados livremente pelo Super Admin. O catálogo oficial fica no código (`src/modules/plans/catalog.ts`): Essencial (referência R$ 119/mês, 1 usuário) e Profissional (referência R$ 199/mês, 2 usuários). Um plano novo, como o futuro Completo, é uma entrada nova no catálogo, sem migração de esquema. `POST/PATCH /admin/plans` foram removidos; `GET /admin/plans` continua listando os planos personalizados anteriores, somente para leitura, e `GET /admin/plan-catalog` expõe o catálogo oficial.

Recursos controlados por plano são apenas os que já existem no produto:

| Recurso              | O que controla                                                       | Essencial | Profissional |
| -------------------- | -------------------------------------------------------------------- | --------- | ------------ |
| `users.invite`       | Convite de usuários adicionais pela empresa                          | Não       | Sim          |
| `catalog.public`     | Vitrine pública e permissão `catalog:manage`                         | Não       | Sim          |
| `commercial.sellers` | Perfil vendedor (convite ou troca de perfil) e carteiras de clientes | Não       | Sim          |

Todos os demais módulos (clientes, produtos, estoque, pedidos, contas a receber, pagamentos, relatórios e documentos) ficam disponíveis em qualquer plano. Nenhum código fora do catálogo compara nomes de planos: o backend consulta `entitlementsFor(assinatura)` e `hasFeature`, e as permissões do perfil são filtradas por `withinPlan`. O `/me` devolve as permissões já filtradas e o resumo do plano, então o frontend reflete as mesmas regras.

O limite de usuários continua sendo o snapshot `userLimit` da assinatura (ADR 0003), alinhado ao plano a cada troca. Vaga ocupada = usuários ativos + convites pendentes válidos (ADR 0002), agora sem contar o Super Admin: vínculos e convites com `seatExempt` não ocupam vaga, não contam como administrador da empresa e só valem enquanto o titular continuar Super Admin. O primeiro administrador de uma empresa precisa ser um usuário dela (`CUSTOMER_ADMIN_REQUIRED`).

Contratos anteriores ao catálogo (`planCode` nulo) mantêm todos os recursos até a migração, para nenhuma empresa perder funcionalidade de forma inesperada.

Troca de plano: o efeito em limites e recursos é imediato. O valor contratado só muda quando informado explicitamente. O downgrade é recusado (`USER_LIMIT_REACHED`) enquanto a empresa ocupar mais vagas que o plano alvo: nenhum usuário é desativado automaticamente. Os recursos perdidos precisam ser confirmados um a um (`FEATURE_LOSS_UNCONFIRMED`). A vitrine publicada sai do ar no downgrade e volta com a configuração preservada se a empresa voltar ao Profissional.

Atualiza a [ADR 0003](0003-planos-versionados.md): os contratos continuam com snapshots próprios, mas a oferta global agora é versionada no código, não em documentos editáveis.
