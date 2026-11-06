# ADR 0012: planos personalizados por cópia no contrato

Situação: aceita em 05/11/2026. Complementa a [ADR 0009](0009-planos-oficiais-e-recursos.md), que continua valendo para os planos oficiais.

## Contexto

Recursos eram derivados só de `planCode`, então o catálogo em código decidia tudo. O Super Admin precisa negociar ofertas exclusivas sem alterar Essencial, Profissional e Gestão, e uma edição da oferta não pode alcançar contratos já assinados. A coleção `plans` já existe, mas guarda contratos anteriores ao catálogo oficial, é somente leitura e tem esquema estrito.

## Decisão

- **Oferta em `customPlans`.** É um modelo versionado, nunca apagado. Desativar só impede novos contratos.
- **Contrato com cópia.** A assinatura recebe `planCode: 'custom'`, `planId`, `planVersion` e `customContract`, com nome, recursos, modelo oficial e `origin`, a oferta como foi contratada. Valor e limite continuam nos campos que cobrança, vagas e relatórios já leem.
- **Um único caminho de direitos.** `entitlementsFor` continua sendo a fonte de `TenantContext.entitlements`. Só a origem da lista muda: o catálogo no plano oficial, a cópia no personalizado. Nenhum sistema paralelo de permissões foi criado.
- **Lista negada por padrão.** Recursos gravados são texto, filtrados por `recognizedFeatures`. Código retirado não quebra a leitura nem libera nada, e recurso futuro nunca entra sozinho em contrato antigo.
- **Base não vendável.** Clientes, pedidos, produtos, estoque, contas a receber e relatórios comerciais ficam em todo plano. Confirmar pedido gera recebível e movimenta estoque, logo retirar um deles deixaria operações pela metade.
- **Dependências no backend.** `featureCatalog` declara o que cada recurso exige. O backend recusa combinação incompleta com `PLAN_DEPENDENCY_MISSING` e nunca completa a lista sozinho. A inclusão automática acontece na tela, que mostra o que entrou.
- **Recursos separados por permissão real.** `purchasing.suppliers`, `finance.recurring` e `finance.dashboard` saíram de recursos maiores, com as permissões `recurring:*` e `financial-dashboard:read`. As operações de vendedor já concedidas incluem as novas permissões, então ninguém perde acesso. Uma operação continua oferecida enquanto o contrato incluir algum recurso dela (`operationInPlan`), e o plano corta só as permissões que faltam. Categorias de despesa seguem em contas a pagar, porque o lançamento de despesas depende delas mesmo sem recorrências.
- **Compras e recebimento continuam juntos.** Compra sem recebimento nunca chega ao estoque, e recebimento sem compra não tem o que receber: separá-los seria uma opção que só produz tela quebrada.
- **Reversão preservada.** `customContract` só existe em contrato personalizado e é removido ao voltar para um plano oficial, então contratos oficiais seguem no formato que a versão anterior da API lê.

## Consequências

- Contrato personalizado impede reverter a API: `rollbackBlockers` informa `plan_custom`. A cobrança emitida nesse contrato guarda o plano e continua impedindo, com `charge_custom`, depois que o contrato volta a um plano oficial. A recuperação está em [gestao-recuperacao.md](../../../ops/prepublication/gestao-recuperacao.md).
- A rotina de recorrências passa a ler contratos `custom` e decide por contrato, com o recurso `finance.recurring`.
- Vender abaixo do Essencial exige outra decisão: controlar por plano módulos que hoje são base.
- Uma nova dependência em recurso existente não corrige contratos antigos sozinha. Quem a introduzir precisa revisar os contratos afetados.
- Contrato gratuito tem mensalidade zero e nunca gera cobrança automática nem próximo vencimento. Se passar a pagar, a cobrança começa na data da mudança, sem retroagir aos meses gratuitos. Cobranças já emitidas não mudam: quem zera um contrato cancela as abertas que não forem devidas.
- A troca de um contrato gratuito para plano oficial não herda R$ 0,00. A requisição precisa trazer o valor (`PLAN_PRICE_REQUIRED`), a tela sugere o preço oficial, e outro valor, inclusive zero, exige `negotiatedPriceConfirmed` (`NEGOTIATED_PRICE_UNCONFIRMED`). A regra vale para qualquer contrato de valor zero, personalizado ou não, porque o risco é o mesmo. Contrato pago mantém o valor quando nada é informado.
- Créditos de fornecedores saem do plano só para operar. A permissão `supplier-credits:read` não depende de recurso (`retainedPermissions`): quem decide quem a tem é o perfil, que a recebe junto de "Contas a pagar · Visualizar". A consulta existe se o contrato inclui compras ou se a própria empresa tem algum crédito registrado, mesmo com saldo zerado (`supplierCreditsAvailable`). O /me só emite a permissão nessas condições, e o serviço repete a verificação. Usar, recuperar e estornar continuam exigindo as permissões de contas a pagar, e nada cria compras ou créditos.
- "Desativar" uma assinatura usa a suspensão existente, que é reversível e preserva dados. Não há comando de cancelamento definitivo.
- A empresa vê o nome do plano personalizado, as vagas e os recursos. Valor original, descrição interna, notas comerciais, motivos e o restante do contrato ficam só no Super Admin.
