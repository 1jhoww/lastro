# Lastro: verificação de backup e restauração

Leitura feita em 05/11/2026 em `lastro-hml`, sem nenhuma alteração. **`lastro-hml` tem clientes reais, e hoje não existe cópia restaurável desses dados.**

## Estado verificado

| Item                        | Estado                                                     | Avaliação                          |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| Proteção contra exclusão    | Ativa                                                      | OK. Impede excluir o banco, não apaga erros de dados |
| PITR                        | Desativado                                                 | **Crítico**                        |
| Retenção de versões         | 1 hora                                                     | Só permite ler o estado recente    |
| Backups agendados           | 0                                                          | **Crítico**                        |
| Backups existentes          | 0                                                          | **Crítico**                        |
| Bucket de exportação        | Não existe                                                 | Falta criar                        |
| Exportação pontual          | Nunca feita                                                | **Crítico** antes de publicar      |
| Restauração                 | Nunca ensaiada                                             | Tempo real desconhecido            |
| Storage                     | Exclusão reversível de 7 dias, sem versionamento           | Só protege exclusão recente        |
| Alertas                     | Nenhum                                                     | Falha só aparece para o cliente    |
| Orçamento                   | Um, de alerta                                              | OK                                 |

`recovery.proposal.json` registra a proteção contra exclusão como desativada. A leitura mostra que ela está ativa desde então.

## O que cada mecanismo cobre

Um backup do Firestore não recupera o sistema inteiro:

| Dado                            | Backup e PITR do Firestore | Como proteger                                         |
| ------------------------------- | -------------------------- | ----------------------------------------------------- |
| Pedidos, financeiro, cadastros  | Sim                        | PITR e backup                                         |
| Logotipos e fotos               | **Não**                    | Storage: cópia ou versão de objetos, a decidir        |
| Contas de usuário               | **Não**                    | `firebase auth:export`, guardado fora do repositório  |
| Segredo de convite              | **Não**                    | Secret Manager mantém as versões                      |
| Índices e regras                | **Não**                    | Declarados no repositório                             |

Exportar usuários gera um arquivo com dados pessoais e hashes de senha. Trate como dado sensível e peça autorização própria.

## Ordem proposta

Nada disto foi executado. Os comandos estão em [gestao-recuperacao.md](gestao-recuperacao.md).

1. **[P1]** Ativar o PITR de 7 dias. Ele não é retroativo: só protege a partir da ativação.
2. **[P1]** Criar o agendamento diário com retenção de 7 dias.
3. Conferir no dia seguinte que o primeiro backup existe.
4. **[P2]** Criar o bucket `lastro-hml-backups` em `southamerica-east1`.
5. **[P2]** Exportar o banco antes de qualquer publicação em produção.
6. Ensaiar a restauração primeiro em homologação, com dados fictícios, para medir o procedimento.
7. Ensaiar em `lastro-hml`, sempre em banco novo e nunca sobre `(default)`.

## Ensaio de restauração

**Nunca restaure sobre o banco em uso.**

```bash
gcloud firestore databases restore --project=lastro-homolog --source-backup=NOME_DO_BACKUP --destination-database=lastro-restauracao --configuration=lastro-homolog
```

Critérios de aceite:

- [ ] Contagem de empresas, assinaturas, pedidos e títulos igual à origem.
- [ ] Isolamento entre empresas preservado.
- [ ] Hash encadeado do estoque confere.
- [ ] Tempo real medido e registrado, contra a meta de 4 horas.
- [ ] Data de exclusão do banco de ensaio definida. Excluir exige autorização.

O banco restaurado não é usado pela API. Para corrigir dados, compare a cópia com o banco em uso e corrija pelos próprios fluxos do sistema, como descreve a [recuperação](gestao-recuperacao.md).

## Metas ainda não medidas

| Meta                            | Valor proposto   | Situação                  |
| ------------------------------- | ---------------- | ------------------------- |
| Perda máxima com PITR           | 1 minuto         | Depende de ativar         |
| Perda máxima com backup diário  | 24 horas         | Depende de ativar         |
| Tempo de restauração            | 4 horas          | Depende do ensaio         |

Custos em [homolog-custos.md](homolog-custos.md#proteção-da-produção). Com o volume atual, ficam abaixo de US$ 0,05 ao mês.
