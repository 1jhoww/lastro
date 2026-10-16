# Cobrança manual das assinaturas e regras de vigência

Ainda não há gateway de pagamento. O Super Admin acompanha as cobranças manualmente, e o sistema mantém registros persistentes em `billingCharges`, gerados de forma idempotente.

## Estado da assinatura e estado da cobrança

O status da assinatura é administrativo: `pending` (aguardando ativação; acesso liberado e nenhuma cobrança gerada), `active`, `suspended` (acesso bloqueado, dados preservados) e os valores legados `past_due` (mantém acesso; a migração converte) e `canceled` (terminal; não há comando de cancelamento). Cada cobrança tem o próprio status financeiro: `pending`, `paid` ou `canceled`. "Vencida" e "próxima do vencimento" são situações derivadas da data (`situation`) e nunca ficam gravadas. Uma cobrança vencida gera alerta no painel. O acesso nunca é bloqueado automaticamente: suspender é sempre uma ação explícita do Super Admin.

## Geração mensal

- Há uma cobrança por assinatura e competência (mês). O id é `{subscriptionId}_{AAAA-MM}`, criado em transação que relê a assinatura. Execuções repetidas ou simultâneas não duplicam, e a cobrança automática nunca duplica uma manual da mesma competência.
- Só geram cobrança as assinaturas `active` com dia de vencimento (1–28), início de cobrança definido e valor maior que zero.
- A cobrança é emitida até 10 dias antes do vencimento. Nunca é emitida para vencimento anterior ao início da cobrança, nem mais de 3 dias depois do vencimento. Essa folga cobre uma falha curta do agendador, mas não cria cobranças retroativas, por exemplo depois de uma suspensão.
- O início da cobrança, na criação ou na ativação, precisa ser hoje ou uma data até um ano à frente. As datas usam o calendário de America/Sao_Paulo.
- O agendamento não depende de o painel ser aberto. O job `dist/src/jobs/billingCycle.js` roda diariamente como Cloud Run Job disparado pelo Cloud Scheduler, com a mesma imagem da API e sem endpoint HTTP. `POST /admin/charges/generate` executa a mesma regra sob demanda. O procedimento está em [operação da plataforma](../operations-platform-billing.md).

## Vigência de alterações

- O valor da cobrança é congelado na emissão. Alterações de plano, valor ou dia de vencimento valem somente para as competências ainda não emitidas, sem rateio.
- Uma cobrança já emitida só muda por correção explícita (`/correct`), com versão esperada, motivo e auditoria dos valores anteriores e novos. A correção também desfaz um pagamento registrado por engano.
- A troca de plano altera limites e recursos imediatamente. O valor só muda quando o Super Admin o informa.
- A suspensão interrompe a geração. A reativação volta para `active`, ou para `pending` se a cobrança nunca foi ativada, sem cobrar os meses suspensos.
- Uma cobrança manual (`POST /admin/charges`) permite registrar uma competência acordada fora dessas regras, de forma explícita e auditada.

## Auditoria

Toda ação do Super Admin sobre contratos e cobranças grava `auditLogs` globais com `tenantId`, ator, motivo, valores anteriores e novos, na mesma transação. A empresa não lê esses registros. Histórico: `GET /admin/subscriptions/{id}/history` e `GET /admin/charges/{id}/history`.
