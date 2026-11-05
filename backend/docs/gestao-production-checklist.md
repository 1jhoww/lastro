# Lastro Gestão: checklist final de homologação e produção

Nada aqui roda sozinho. Cada marca com **[aprovação]** exige autorização específica do responsável, e aprovar uma etapa não aprova a seguinte.

**`lastro-hml` tem clientes reais e é produção, apesar do nome.** Este checklist segue a opção A da [proposta de ambientes](../../ops/prepublication/gestao-ambientes.md): uma homologação nova, com a produção onde está.

Referências em `ops/prepublication/`: [inventário](../../ops/prepublication/gestao-inventario-hml.md), [índices](../../ops/prepublication/gestao-indices-plano.md), [ambientes](../../ops/prepublication/gestao-ambientes.md), [agendamento](../../ops/prepublication/gestao-recorrencias-agendamento.md) e [recuperação](../../ops/prepublication/gestao-recuperacao.md).

## Planos personalizados

Entram na mesma publicação do Gestão ([ADR 0012](adr/0012-planos-personalizados.md)). Não exigem índice novo, job novo nem migração de dados.

- [ ] Confirmar antes da publicação que a coleção `customPlans` segue fechada pelas regras do Firestore.
- [ ] Publicar a API antes do frontend, como no restante do Gestão: a tela nova depende das rotas `/admin/custom-plans`.
- [ ] Antes de criar o primeiro contrato personalizado real, cumprir a [liberação do primeiro contrato](../../ops/prepublication/gestao-recuperacao.md#primeiro-contrato-personalizado-real): depois dele, `plan_custom` impede reverter a API, e `charge_custom` continua impedindo depois da primeira cobrança.
- [ ] Depois da publicação, conferir em uma empresa do Gestão: compras, recorrências, painel financeiro e relatórios.

## Parte 0: proteger a produção atual

Independe do Gestão e vem primeiro.

- [ ] Confirmar no console saldo, validade e tipo do faturamento.
- [ ] **[aprovação]** Ativar backup diário e PITR.
- [ ] **[aprovação]** Exportar o Firestore para um bucket próprio.
- [ ] Ensaiar uma restauração em banco temporário e registrar o tempo real.
- [ ] **[aprovação]** Criar canal e alertas de erro 5xx e de indisponibilidade da API.
- [ ] **[aprovação]** Trocar as variáveis de Preview da Vercel, que hoje apontam para a produção.
- [ ] **[aprovação]** Desligar a publicação automática de Production por push em `main`.
- [ ] Não usar contas de teste nem validação remota em `lastro-hml` sem autorização.

## Parte 1: homologação em `lastro-homolog`

### 1. Criar o ambiente **[aprovação]**

- [ ] Criar projeto, Auth, Firestore, Storage, segredos e conta de serviço próprios.
- [ ] Criar a API e o projeto Vercel de homologação.
- [ ] Aplicar todos os índices e campos do repositório. Ambiente vazio aceita publicação inteira.
- [ ] Popular com dados fictícios. Nunca copiar dados reais.

### 2. Publicar a branch candidata

- [ ] Revisar `feat/lastro-gestao`.
- [ ] Publicar API e frontend em homologação.
- [ ] Conferir que nenhuma variável aponta para `lastro-hml`.

### 3. Validar sem o plano Gestão

- [ ] Essencial e Profissional mantêm preço, módulos e acesso.
- [ ] Empresa fora do plano recebe `FEATURE_NOT_IN_PLAN` em `GET /purchases`.
- [ ] Pedido, recebimento de cliente, movimentação avulsa e relatório funcionam.

### 4. Validar o plano Gestão

- [ ] Listas de compras, títulos, fornecedores e créditos abrem sem erro de índice.
- [ ] Compra confirmada gera títulos e não muda o estoque.
- [ ] Recebimento parcial muda estoque e custo médio.
- [ ] Encerramento com abatimento reduz títulos e mantém o estoque.
- [ ] Cobrança integral aparece na linha própria do resultado.
- [ ] Pagamento parcial aparece como caixa realizado.
- [ ] Devolução de valor a recuperar entra no caixa.
- [ ] Relatórios `purchases-supplier` e `cash-flow` exportam CSV e PDF.
- [ ] Testar no celular, no navegador. Testar o app nativo se houver build.

### 5. Validar operação

- [ ] Criar job, rodar `--dry-run`, depois execução real.
- [ ] Ativar agendamento e alertas, e conferir a primeira execução automática.
- [ ] Rodar o verificador de reversão com e sem dados do Gestão.
- [ ] **Ensaiar a publicação da produção:** partir da versão anterior com dados fictícios, aplicar índices, API sem tráfego, tráfego e frontend, e medir o tempo.
- [x] Repetir o caso `return` do teste de capacidade com limite maior. Passou em 05/11/2026, em emulador local, com limite de 2 h por caso.
- [ ] Observar ao menos 7 dias sem erro inesperado.

## Parte 2: produção em `lastro-hml`

Não autorizada. **Pré-requisitos:** Parte 0 e Parte 1 concluídas.

### 1. Preparar **[aprovação]**

- [ ] Combinar a janela e avisar os clientes.
- [ ] Anotar a revisão da API e o deployment da Vercel.
- [ ] Exportar o Firestore na véspera ou no dia.
- [ ] Repetir o inventário e parar se algo divergir.

### 2. Índices **[aprovação]**

- [ ] Aplicar as 32 isenções de campo, uma a uma.
- [ ] Criar os 34 índices compostos, um a um.
- [ ] Aguardar 184 `READY`, sem `CREATING` nem `NEEDS_REPAIR`.
- [ ] Não usar `firebase deploy` em bloco.

### 3. API **[aprovação]**

- [ ] Promover a imagem validada, sem tráfego. Sem imagem pronta, publicar a partir da versão aprovada:

  ```bash
  gcloud run deploy lastro-api-hml --source=backend --region=southamerica-east1 --configuration=lastro-hml --no-traffic --tag=gestao --quiet
  ```

- [ ] Conferir `/health/live` e `/health/ready` na URL com a etiqueta `gestao`.
- [ ] Mover o tráfego:

  ```bash
  gcloud run services update-traffic lastro-api-hml --to-latest --region=southamerica-east1
  ```

- [ ] Confirmar que o frontend atual segue funcionando para os clientes.
- [ ] Rodar o verificador e confirmar `rollbackSafe: true`.

### 4. Frontend **[aprovação]**

- [ ] Só depois da API. Fazer merge em `main` e promover o deployment.
- [ ] Em deploy manual, partir da raiz do repositório e apagar `%TEMP%\metro-cache` antes.
- [ ] Conferir no pacote que não há `127.0.0.1` nem `demo-lastro`.

### 5. Observar sem o Gestão

- [ ] Clientes atuais seguem com preço, módulos e acesso iguais.
- [ ] Observar 24 horas: erros, latência e custo.
- [ ] Verificador ainda em `rollbackSafe: true`.

### 6. Primeira empresa no Gestão **[aprovação]**

**Ponto sem volta:** depois daqui, a API anterior não lê essa assinatura. A saída passa a ser corrigir para a frente.

- [ ] Liberar uma empresa por vez, com aviso prévio.
- [ ] Conferir índices, compras, títulos e painel nessa empresa.

### 7. Recorrências **[aprovação]**

- [ ] Habilitar Cloud Scheduler e criar as duas contas de serviço.
- [ ] Criar o job e executar `--dry-run`. Critério: `failed: 0`.
- [ ] Criar métricas, canal e alerta de falha.
- [ ] **[aprovação própria]** Ativar o agendamento e o alerta de ausência.
- [ ] Conferir a primeira execução real.

### 8. Encerrar

- [ ] Registrar revisão, deployment, horários e resultados.
- [ ] Revisar o primeiro backup depois da publicação.

## Reversão

| Componente | Como reverter                                                                                |
| ---------- | -------------------------------------------------------------------------------------------- |
| Frontend   | Promover o deployment anterior. Seguro a qualquer momento                                    |
| API        | Só com `rollbackSafe: true`. Do contrário, corrigir para a frente                            |
| Índices    | Manter. Não afetam a versão anterior                                                         |
| Job        | Pausar o agendador. Títulos gerados continuam válidos                                        |
| Dados      | Restaurar em banco novo e corrigir a partir dele. Nunca sobre o banco em uso                 |

```bash
gcloud run services update-traffic lastro-api-hml --to-revisions=REVISAO_ANTERIOR=100 --region=southamerica-east1
```

Encerramento de saldo não tem desfazer. Um encerramento errado se corrige no financeiro.

Detalhes em [recuperação](../../ops/prepublication/gestao-recuperacao.md).
