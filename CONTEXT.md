# Fundação do Lastro

Este contexto define quem pode usar o Lastro, em qual empresa e sob quais condições contratadas.

## Language

**Empresa (tenant)**:
Organização contratante com usuários e dados comerciais próprios.
_Avoid_: Conta, cliente comercial.

**Identidade**:
Pessoa identificada na plataforma, que pode ter vínculos com várias empresas.
_Avoid_: Cliente, perfil empresarial.

**Vínculo**:
Participação de uma identidade em uma empresa, com estado e perfil próprios.
_Avoid_: Conta global, permissão global.

**Administrador da empresa**:
Usuário com poderes de gestão na empresa à qual está vinculado.
_Avoid_: Super Admin, proprietário exclusivo.

**Vendedor**:
Usuário comercial cujo acesso fica restrito à sua carteira e aos seus pedidos.
_Avoid_: Administrador limitado.

**Super Admin Lastro**:
Operador da Hepta Studios autorizado a administrar empresas e contratos da plataforma.
_Avoid_: Administrador de todas as empresas.

**Convite**:
Proposta de vínculo destinada a uma identidade com email verificado, válida por prazo limitado.
_Avoid_: Usuário ativo, cadastro automático.

**Vaga ocupada**:
Capacidade contratada utilizada por um vínculo ativo ou convite pendente ainda válido; vínculos e convites do Super Admin não ocupam vaga.
_Avoid_: Quantidade de administradores.

**Acesso de suporte**:
Vínculo do Super Admin a uma empresa, que não ocupa vaga e só vale enquanto ele mantiver o papel de plataforma.
_Avoid_: Usuário da empresa, administrador da empresa.

**Plano**:
Oferta comercial oficial definida pelo sistema (Essencial, Profissional), com limite de usuários e recursos.
_Avoid_: Contrato vigente de uma empresa, plano cadastrado livremente.

**Recurso do plano**:
Capacidade existente liberada ou não pelo plano (convites adicionais, vitrine, vendedores e carteiras).
_Avoid_: Módulo novo, permissão de perfil.

**Assinatura**:
Condições contratadas (plano, valor, dia de vencimento, início da cobrança) e estado administrativo de acesso de uma empresa.
_Avoid_: Pagamento bancário, plano global, situação financeira.

**Cobrança**:
Valor de uma competência de uma assinatura, acompanhado manualmente pelo Super Admin, com estado financeiro próprio.
_Avoid_: Recebível de cliente comercial, bloqueio de acesso.

**Competência**:
Mês (AAAA-MM) a que uma cobrança se refere; no máximo uma cobrança por assinatura e competência.
_Avoid_: Data de pagamento, mês de vencimento.

**Cliente comercial**:
Pessoa ou organização atendida pela empresa, com contato e documento fiscal opcional.
_Avoid_: Empresa contratante, identidade de login.

**Carteira comercial**:
Clientes cujo responsável atual é um vendedor da empresa; propriedade verificada pelo servidor.
_Avoid_: Filtro de tela, lista pública de clientes.

**Produto**:
Item com SKU único na empresa, unidade e preço padrão atual em centavos.
_Avoid_: Saldo de estoque, preço histórico de pedido.

**Categoria**:
Agrupamento empresarial desativável com preservação das referências existentes.
_Avoid_: Categoria global da plataforma.

**Estoque da empresa**:
Saldo único compartilhado de cada produto na empresa, sem depósitos ou estoque por vendedor.
_Avoid_: Estoque global da plataforma, carteira de estoque.

**Saldo físico / reservado / disponível**:
Quantidades inteiras escaladas; disponível é físico menos reservado, sempre não negativo.
_Avoid_: Três saldos independentes, quantidade enviada pelo cliente como autoridade.

**Movimentação de estoque**:
Evento imutável da API com quantidade, saldos antes/depois, ator, origem, sequência e idempotência.
_Avoid_: Edição do saldo sem histórico.

**Necessidade de reposição**:
Produtos abaixo do mínimo em disponibilidade, com sugestão derivada do mínimo menos disponível.
_Avoid_: Compra automática, reposição por vendedor.

**Pedido**:
Compromisso comercial da empresa com um cliente, sob responsabilidade de um usuário, com rascunho e condições confirmadas preservadas.
_Avoid_: Pagamento, nota fiscal.

**Rascunho de pedido**:
Proposta comercial em preparação, que pode estar incompleta e ainda não compromete estoque nem gera recebíveis.
_Avoid_: Pedido confirmado sem reserva.

**Aprovação de desconto**:
Autorização administrativa vinculada às condições e à versão de um rascunho; uma mudança nessas condições exige nova aprovação.
_Avoid_: Permissão permanente do vendedor.

**Reserva de pedido**:
Quantidade comprometida para uma linha de um pedido confirmado, liberável ou expedível somente por aquele pedido.
_Avoid_: Baixa física, reserva livre do vendedor.

**Expedição**:
Saída física integral de um pedido confirmado, consumindo suas reservas sem apagar o compromisso comercial.
_Avoid_: Pagamento, cancelamento.

**Confirmação de entrega**:
Registro de que o cliente recebeu um pedido expedido, separado da expedição; no máximo uma por pedido e sem efeito em estoque ou financeiro.
_Avoid_: Expedição, romaneio assinado, entrega presumida.

**Visita comercial**:
Atendimento manual a um cliente (presencial ou remoto), com responsável e data, que não exige pedido.
_Avoid_: Pedido, entrega, tarefa agendada.

**Registro automático de entrega**:
Entrada do histórico do cliente criada somente pela confirmação de entrega, atribuída ao vendedor do pedido.
_Avoid_: Visita presencial, registro de expedição.

**Estimativa de recompra**:
Data provável de nova compra: última compra confirmada mais a mediana dos intervalos entre compras confirmadas do último ano.
_Avoid_: Previsão garantida, meta de venda.

**Recebível**:
Obrigação a receber originada de uma parcela do pedido confirmado, com valor original e saldo em aberto próprios.
_Avoid_: Dinheiro recebido, cobrança bancária.

**Condição de pagamento**:
Regra comercial de prazos e repartição do valor de uma compra em parcelas.
_Avoid_: Forma de pagamento, recebimento realizado.

**Forma de pagamento**:
Meio pelo qual um valor é recebido, como PIX, dinheiro ou transferência.
_Avoid_: Prazo de pagamento, condição de parcelamento.

**Recebimento**:
Registro de dinheiro recebido de um cliente, com origem e destinação identificadas.
_Avoid_: Pedido confirmado, previsão de pagamento.

**Estorno financeiro**:
Reversão rastreável de um lançamento anterior, preservando o registro original.
_Avoid_: Exclusão de pagamento, devolução bancária presumida.

**Crédito do cliente**:
Valor de origem identificada disponível ao cliente para liquidar obrigações futuras.
_Avoid_: Desconto comercial, saldo livre sem origem.

**Obrigação de devolução de dinheiro**:
Compromisso de devolver um valor recebido, distinto da comprovação de que a devolução ocorreu.
_Avoid_: Devolução de estoque, reembolso já realizado.

**Intenção de devolução**:
Registro da quantidade pretendida de retorno de uma expedição, que não comprova recebimento físico nem restituição financeira.
_Avoid_: Entrada automática no estoque, reembolso concluído.

**Recebimento físico de devolução**:
Confirmação auditável das quantidades realmente retornadas, distinguindo revendáveis e danificadas.
_Avoid_: Quantidade apenas prevista, crédito automático.

**Resolução financeira de devolução**:
Abatimento rastreável do valor elegível recebido, seguido da restauração de fontes liquidadas quando necessário.
_Avoid_: Recalcular preços atuais, presumir devolução bancária.
