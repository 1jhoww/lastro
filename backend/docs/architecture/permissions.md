# Matriz de permissões

| Operação                                           | Administrador                               | Vendedor                                 | Super Admin sem vínculo |
| -------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | ----------------------- |
| Consultar empresa atual                            | Sim                                         | Sim                                      | Não                     |
| Alterar empresa                                    | Sim                                         | Não                                      | Não                     |
| Listar/convidar/revogar/alterar vínculos           | Sim                                         | Não                                      | Não                     |
| Criar empresas e recuperar primeiro convite        | Não                                         | Não                                      | Sim                     |
| Criar/versionar planos                             | Não                                         | Não                                      | Sim                     |
| Gerenciar assinaturas/limites/condições            | Não                                         | Não                                      | Sim                     |
| Consultar produtos/preços                          | Todos, inclusive inativos                   | Somente ativos                           | Não                     |
| Gerenciar clientes                                 | Todos                                       | Carteira própria, sem responsável/status | Não                     |
| Transferir/desativar/reativar clientes             | Sim                                         | Não                                      | Não                     |
| Gerenciar produtos/preços/categorias               | Sim                                         | Não                                      | Não                     |
| Consultar categorias                               | Sim                                         | Sim, inclusive inativas                  | Não                     |
| Ler imagem privada                                 | Sim                                         | Produto ativo                            | Não                     |
| Upload/remover imagem/configurar visibilidade      | Sim                                         | Não                                      | Não                     |
| Criar/consultar/editar/confirmar pedidos           | Todos; editar só draft                      | Próprios + carteira atual; editar draft  | Não                     |
| Aplicar/remover descontos por comando              | Sim, versão/motivo                          | Não                                      | Não                     |
| Expedir pedido integral                            | Confirmados                                 | Próprios + carteira atual, confirmados   | Não                     |
| Cancelar pedido                                    | Draft/confirmed sem pagamentos; motivo      | Não                                      | Não                     |
| Consultar histórico/parcelas do pedido             | Todos                                       | Próprios + carteira atual                | Não                     |
| Títulos/recebimentos/créditos/estornos/histórico E | Implementado; conforme permissão específica | Não                                      | Não                     |
| Gerar documentos                                   | Própria empresa                             | Próprios e carteira atual                | Não                     |

Clientes/produtos/imagens B, estoque C, pedidos D, financeiro E, catálogo F e documentos G têm implementação real. Administrator não ganha permissão da plataforma. Vendedor ganhou orders:own:dispatch, sem inventory:manage ou orders:all:manage.

## Fase G vigente

| Operação                          | Administrador                         | Vendedor                                            | Plataforma sem vínculo |
| --------------------------------- | ------------------------------------- | --------------------------------------------------- | ---------------------- |
| PDF comercial / romaneio          | documents:own:read, pedido da empresa | documents:own:read, pedido próprio e carteira atual | Não                    |
| CSV clientes / produtos / pedidos | reports:read                          | Não                                                 | Não                    |
| CSV contas a receber              | reports:read + receivables:read       | Não                                                 | Não                    |

G não adiciona permissões nem papel empresarial. PDFs usam mesma autorização transacional de pedido/carteira e revalidam depois da renderização. Exportações administrativas relêem vínculo/permissão antes da entrega. Romaneio usa somente projeção física de guards comprovados; nenhum campo monetário, saldo, fonte ou nota comercial é entregue. Super Admin legítimo com vínculo empresarial segue somente permissões daquele vínculo, sem privilégio transversal. Assinatura suspensa/cancelada bloqueia downloads como outras rotas privadas.

| Estoque da Fase C                         | Administrador                                            | Vendedor                     | Plataforma sem vínculo |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------- | ---------------------- |
| Saldos físico/reservado/disponível/mínimo | Todos                                                    | Somente disponível de ativos | Não                    |
| Entradas/ajustes                          | Sim, reason + idempotência; ajuste com versão            | Não                          | Não                    |
| Histórico/reconciliação                   | Sim                                                      | Não                          | Não                    |
| Alterar mínimo pelo cadastro de produto   | Sim, versão                                              | Não                          | Não                    |
| Reposição                                 | Sim; ativos por padrão                                   | Não                          | Não                    |
| Reserva/expedição/liberação de pedido     | Via pedido legítimo autorizado                           | Confirmar/expedir próprios   | Não                    |
| Receber devolução de expedição por HTTP   | Via retorno E legítimo, versão, qualidade e idempotência | Não                          | Não                    |

Na Fase D transferência de carteira bloqueia acesso histórico do vendedor anterior e não transfere pedidos ao novo; administrador preserva acesso. Só rascunhos permitem alterar responsável. Aprovação de desconto exige administrador ainda ativo no momento da confirmação; edição invalida aprovação, sem permitir discount/null por vendedor. Todos os gates são relidos no mesmo snapshot das escritas, inclusive replay. Cancelamento administrativo bloqueia registros financeiros e pedidos expedidos.

Vendedor cria clientes atribuídos ao próprio UID e pode editar nome, fantasia, documento, email, telefone, endereço e notas dos próprios clientes. Não escolhe responsável por criação/PATCH nem altera status. Propriedade e autorização são relidas em transações. Responsável escolhido pelo administrador deve ser vendedor ativo da mesma empresa.

Alterações de perfil/status são restritas a administrador ativo. Vendedor não pode se promover. Administrador pode se rebaixar/desativar somente quando permanecer outro administrador ativo. Desativação remove imediatamente acesso daquele vínculo, inclusive com token emitido anteriormente; não desativa a identidade nas outras empresas.

## Fase E vigente

| Operação                                                                       | Administrador                                       | Vendedor                                           | Plataforma sem vínculo |
| ------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| Selecionar opções comerciais e simular parcela de pedido autorizado            | Sim                                                 | Sim, opções ativas e pedido próprio/carteira atual | Não                    |
| Cadastrar/versionar/desativar condição ou forma                                | payment-settings:manage                             | Não                                                | Não                    |
| Consultar títulos, saldos, fontes, diário, reconciliação, obrigação e retornos | receivables:read                                    | Não                                                | Não                    |
| Registrar recebimento ou aplicar crédito legítimo                              | payments:manage                                     | Não                                                | Não                    |
| Estornar recebimento/aplicação                                                 | payments:reverse, autenticação recente              | Não                                                | Não                    |
| Cancelar confirmado com efeitos financeiros/estoque                            | financial-cancellation:manage, autenticação recente | Não                                                | Não                    |
| Confirmar obrigação manual de devolução                                        | refunds:manage, autenticação recente                | Não                                                | Não                    |
| Criar/corrigir/cancelar saldo/receber/resolver retorno                         | returns:manage, autenticação recente                | Não                                                | Não                    |

Autenticação recente: até 300 segundos; tempo futuro acima de 30 segundos é rejeitado. Autorização atual e permissão específica são relidas dentro do commit e do replay. Opções comerciais omitem dados administrativos; nenhuma rota financeira usa permissão de vendedor. Cancelamento D simples segue restrito a pedidos sem evidência financeira; efeitos E exigem comando financeiro próprio.

GET returns/{id}/resolution-preview usa receivables:read e não realiza mutações. Aceite integral, parcial ou zero de dano em returns/{id}/resolve continua sob returns:manage e autenticação recente, com valor e limites validados na transação. Vendedor e plataforma sem vínculo não consultam preview financeiro ou decidem aceite.

## Fase F vigente

GET/PUT catalog-settings usam catalog:manage, já pertencente somente ao administrador. Modificação relê vínculo/identidade/tenant/assinatura na transação, inclusive replay; vendedor e plataforma sem vínculo não leem configuração. Produtos são publicados por catalogVisible em products:manage existente, sem ampliar permissão de vendedor.

Rotas public/catalogs são scope=public, sem Bearer ou X-Tenant-Id. Slug resolve tenant no servidor; exige tenant active, catálogo enabled e assinatura active/past_due. suspended/canceled e ausência retornam indisponibilidade uniforme, sem divulgar motivo privado. Produto precisa ser active/catalogVisible e pertencer à empresa resolvida. Nenhuma permissão interna ou autoria deriva do visitante. Imagem privada somente pode ser entregue pelo recurso público elegível com nova verificação depois do I/O. Público não cria cliente/pedido, não acessa estoque/financeiro e não pode modificar catálogo.
