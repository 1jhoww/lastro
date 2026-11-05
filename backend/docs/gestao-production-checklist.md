# Lastro Gestão: checklist final de homologação e produção

Nada aqui roda sozinho. Cada marca com **[aprovação]** exige autorização específica do responsável, e aprovar uma etapa não aprova a seguinte.

Referências em `ops/prepublication/`: [inventário](../../ops/prepublication/gestao-inventario-hml.md), [índices](../../ops/prepublication/gestao-indices-plano.md), [ambientes](../../ops/prepublication/gestao-ambientes.md), [agendamento](../../ops/prepublication/gestao-recorrencias-agendamento.md) e [recuperação](../../ops/prepublication/gestao-recuperacao.md).

## Parte 1: homologação em `lastro-hml`

### 1. Antes de começar

- [ ] Responder: as 2 assinaturas ativas são de clientes reais? Se sim, trate cada etapa como produção.
- [ ] Revisar a branch `feat/lastro-gestao`. Ela não vai para `main` antes da etapa 6.
- [ ] Confirmar a identidade: configuração `lastro-hml` do `gcloud`, conta do Lastro. Nunca use a configuração padrão da máquina.
- [ ] Confirmar faturamento e créditos no console. Sem faturamento, o limite de índices cai para 200.
- [ ] Anotar a revisão atual da API e o deployment atual da Vercel.
- [ ] Repetir o inventário e parar se algo divergir.

### 2. Backup **[aprovação]**

- [ ] Criar o bucket de backup e exportar o Firestore.
- [ ] Confirmar a exportação concluída.

### 3. Índices **[aprovação]**

- [ ] Aplicar as 32 isenções de campo, uma a uma.
- [ ] Criar os 34 índices compostos, um a um.
- [ ] Aguardar 184 `READY`, sem `CREATING` nem `NEEDS_REPAIR`.
- [ ] Não usar `firebase deploy` em bloco.

### 4. API sem tráfego **[aprovação]**

- [ ] Publicar revisão sem tráfego, a partir da branch:

  ```bash
  gcloud run deploy lastro-api-hml --source=backend --region=southamerica-east1 --configuration=lastro-hml --no-traffic --tag=gestao --quiet
  ```

- [ ] Conferir `/health/live` e `/health/ready` na URL com a etiqueta `gestao`.
- [ ] Nenhuma variável nova. Flags omitidas mantêm ambiente e segredo.

### 5. Tráfego na API **[aprovação]**

- [ ] Mover 100% para a revisão nova:

  ```bash
  gcloud run services update-traffic lastro-api-hml --to-latest --region=southamerica-east1
  ```

- [ ] Confirmar que o frontend atual segue funcionando: pedidos, clientes, estoque e financeiro.
- [ ] Executar o verificador e confirmar `rollbackSafe: true`.

### 6. Frontend **[aprovação]**

- [ ] Só depois da API. Fazer merge em `main`, o que publica na Vercel. Um deploy manual parte da raiz do repositório, depois de apagar `%TEMP%\metro-cache`.
- [ ] Conferir no pacote que não há `127.0.0.1` nem `demo-lastro`.

### 7. Smoke tests sem o plano Gestão

- [ ] Essencial e Profissional mantêm preço, módulos e acesso.
- [ ] Empresa fora do plano recebe `FEATURE_NOT_IN_PLAN` em `GET /purchases`.
- [ ] Pedido, recebimento de cliente, movimentação avulsa e relatório funcionam.
- [ ] Verificador ainda em `rollbackSafe: true`.

### 8. Empresa de teste no Gestão **[aprovação]**

**Ponto sem volta:** depois daqui, a API anterior não lê a empresa. A saída passa a ser corrigir para a frente.

- [ ] Criar ou mover só uma empresa de teste, sem dados reais.
- [ ] Listas de compras, títulos, fornecedores e créditos abrem sem erro de índice.
- [ ] Compra confirmada gera títulos e não muda o estoque.
- [ ] Recebimento parcial muda estoque e custo médio.
- [ ] Encerramento com abatimento reduz títulos e mantém o estoque.
- [ ] Cobrança integral aparece na linha própria do resultado.
- [ ] Pagamento parcial aparece como caixa realizado.
- [ ] Devolução de valor a recuperar entra no caixa.
- [ ] Relatórios `purchases-supplier` e `cash-flow` exportam CSV e PDF.
- [ ] Testar no celular, no navegador. Testar o app nativo se houver build.

### 9. Recorrências em homologação **[aprovação]**

- [ ] Habilitar Cloud Scheduler e criar as duas contas de serviço.
- [ ] Criar o job e executar `--dry-run`. Critério: `failed: 0`.
- [ ] Criar métricas, canal e alerta de falha.
- [ ] **[aprovação própria]** Ativar o agendamento e o alerta de ausência.
- [ ] Conferir a primeira execução real.

### 10. Encerramento da homologação

- [ ] Observar ao menos 7 dias sem erro inesperado.
- [ ] Repetir o caso `return` do teste de capacidade com limite maior.
- [ ] Registrar revisão, deployment, horários e resultados.
- [ ] Decidir sobre a ida à produção.

## Parte 2: produção

Não autorizada. **Pré-requisito:** ambiente próprio, conforme a [proposta de ambientes](../../ops/prepublication/gestao-ambientes.md). Publicar "em produção" no projeto atual é só repetir a homologação.

### Antes do primeiro dado

- [ ] **[aprovação]** Criar projeto, Firestore, Auth, Storage, segredos e contas de serviço próprios.
- [ ] Ativar proteção contra exclusão, PITR e backup diário.
- [ ] Ensaiar uma restauração em banco temporário e registrar o tempo real.
- [ ] Criar orçamento, canais e alertas de API, job e backup.
- [ ] Definir responsáveis por plantão e reversão.

### Publicação **[aprovação]**

- [ ] Promover a mesma imagem validada em homologação, pelo digest.
- [ ] Índices e regras antes da API. API antes do frontend.
- [ ] Publicar revisão sem tráfego, testar, e só então mover o tráfego.
- [ ] Executar os smoke tests das etapas 7 e 8 com contas de teste.
- [ ] Agendamentos desligados até a primeira semana estável.

### Depois de publicar

- [ ] Liberar empresas aos poucos.
- [ ] Acompanhar erros, latência, custo e o job diário.
- [ ] Revisar o primeiro backup real.

## Reversão

| Componente | Como reverter                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Frontend   | Promover o deployment anterior. Seguro a qualquer momento                                             |
| API        | Só com `rollbackSafe: true`. Do contrário, corrigir para a frente                                     |
| Índices    | Manter. Não afetam a versão anterior                                                                  |
| Job        | Pausar o agendador. Títulos gerados continuam válidos                                                 |
| Dados      | Restaurar em banco novo e corrigir a partir dele. Nunca sobre o banco em uso                          |

```bash
gcloud run services update-traffic lastro-api-hml --to-revisions=REVISAO_ANTERIOR=100 --region=southamerica-east1
```

Encerramento de saldo não tem desfazer. Um encerramento errado se corrige no financeiro.

Detalhes em [recuperação](../../ops/prepublication/gestao-recuperacao.md).
