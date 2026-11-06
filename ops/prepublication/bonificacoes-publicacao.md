# Publicação das bonificações

Nada aqui foi executado. Índices, API e frontend em `lastro-hml` exigem autorização do responsável, e `lastro-hml` é produção.

## Ordem

1. Criar os índices, um comando por vez. Nunca usar `firebase deploy` em massa.
2. Esperar todos os índices compostos ficarem `READY`.
3. Publicar a API e conferir `/health/ready`.
4. Publicar o frontend. Push em `main` dispara a Vercel, então a API vem antes.
5. Registrar uma bonificação de teste somente se o responsável autorizar: ela bloqueia a reversão da API.

## Índices compostos

Coleção `bonuses`, todos com `occurredAt` decrescente no fim:

- `kind`
- `customerId`
- `responsibleUid`
- `responsibleUid`, `kind`
- `responsibleUid`, `customerId`

Coleção `bonusEvents`, ambos com `occurredAt` crescente no fim:

- `bonusId`
- `type`

## Campos sem índice

- `bonuses`: `lines`, `linePrices`, `notes`, `reasonDetail`, `customerName`
- `bonusEvents`: `lines`, `reason`
- `bonusOperations`: `result`, `payloadHash`
- `bonusCostSnapshots`: `lines`

As definições estão em `backend/firestore.indexes.json`, geradas por `backend/scripts/bonus-indexes.mjs`. Índice em coleção vazia termina rápido.

## Compatibilidade

- Nenhum documento existente muda. Pedido sem bonificação não tem documento em `bonuses`.
- Não há migração nem job.
- A API anterior não lê movimentos com tipo `STOCK_BONUS_*` ou origem `bonus`.
- Depois da primeira bonificação real, reverter a API quebra a leitura de estoque daquele produto. Antes de reverter, rode `npm run job:rollback-check`: o motivo `bonus_record` indica o bloqueio.
- Rascunho salvo pela API nova pode ficar com bonificação sem efeito de estoque; só a confirmação reserva.

## Riscos de produção

- `lastro-hml` segue sem backup, PITR e alertas. A proposta está em `firestore-backup-pitr.md` e deve ser aplicada antes desta publicação.
- A correção do BUG-001 continua fora desta entrega, sem commit na worktree `gestao-ux`.
- O Lastro não emite nota fiscal. A empresa confirma com o contador a nota de remessa em bonificação.
