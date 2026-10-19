# Lastro — configuração autorizada aplicada em homologação

Data: 18/10/2026, America/Sao_Paulo. Destino exclusivo: projeto existente `lastro-hml`, Firestore `(default)`, Vercel `lastro-hml`.

## Resultado

| Grupo | Alteração executada                                                                                                                   | Verificação                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G2    | Isenção de índices simples somente em visits.notes, visits.customerName, visits.payloadHash, deliveries.notes e deliveries.receivedBy | Cinco configurações efetivas com indexes vazio; os mesmos 134 índices compostos, TTL e demais campos preservados. Cinco operações encerradas com sucesso. |
| G3    | Removido somente o primeiro U+FEFF das três variáveis públicas production aprovadas                                                   | Restante dos valores idêntico ao original; IDs, tipos, escopos e demais metadados preservados. Deployment e destinos/aliases conferidos sem mudança       |
| G5    | Delete protection ativada no banco de homologação                                                                                     | PITR permanece desativado, retenção 3600 s, tipo/região/configuração e agendamentos preservados. Nenhum backup ou recurso adicional criado                |
| G4    | Papel lastroRuntimeAuthUpdate criado com somente firebaseauth.users.update e vinculado ao runtime SA                                  | Diff completo de IAM confirma apenas o binding autorizado; todos os bindings anteriores preservados                                                       |

As três variáveis são EXPO_PUBLIC_API_URL, EXPO_PUBLIC_FIREBASE_PROJECT_ID e EXPO_PUBLIC_WEB_BASE_URL. O target production desse projeto é a homologação principal. A build atual ainda contém os valores antigos; a correção será incorporada somente numa publicação futura autorizada.

G4 refere-se somente a serviceAccount:lastro-api-hml@lastro-hml.iam.gserviceaccount.com. O viewer existente continua fornecendo users.get. Nenhum Auth Admin, permissão de criação/exclusão de usuários, leitura de hashes ou envio de e-mail foi acrescentado. O teste real de Meu Perfil/desbloqueio continua pendente; esta rodada comprovou a configuração IAM, sem alterar usuários.

## Limites respeitados

- Não foram criados os 16 índices compostos pendentes. Os 134 existentes permanecem iguais.
- Nenhum build, upload de candidato, commit, push, deploy, promoção ou mudança de tráfego foi executado.
- Cloud Run mantém revisão `lastro-api-hml-00003-jjc`, service account e tráfego anteriores. Vercel mantém o deployment `dpl_6ax4B9GsLyg1rZWr2L27WhotJzDr`.
- Nenhum documento comercial foi consultado, alterado ou apagado. Nenhuma conta real ou sintética foi usada em testes funcionais nesta rodada.
- Não foram habilitados PITR, backup, alertas, serviços adicionais ou aumento de capacidade.
- Candidato fechado `beta-20261018-eb460d1fd6a0` permanece intacto; este relatório fica fora desse pacote.

## Divergências e custo

Nenhuma divergência encontrada nos diffs de configuração. As cinco operações assíncronas do Firestore terminaram.

Custo incremental esperado para os quatro grupos: R$0. Nenhum novo componente faturável foi ativado e nenhum custo inesperado foi identificado nas ações executadas. Isso não é medição da fatura em tempo real nem afirma que a infraestrutura existente deixou de consumir créditos.

## Próxima autorização

Antes de qualquer execução adicional, apresentar custo/impacto dos 16 índices compostos e de uma única build Linux do candidato. Não executar essas etapas sem autorização. Deploy e smoke sintético serão autorizações posteriores, conforme o plano beta. Para dados financeiros comerciais, recuperação restaurável permanece um gate separado; proteção contra exclusão não substitui backup.

[Resultado sanitizado](evidence/beta-configuracao/resultado.json). Snapshots completos, valores públicos antes/depois e logs de operações ficam somente no diretório privado backend/.local/beta. Nenhuma senha, token ou configuração Auth sensível foi incluída nesta evidência.
