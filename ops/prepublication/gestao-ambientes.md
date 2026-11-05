# Lastro: separação entre homologação e produção

Proposta. Nenhum recurso foi criado ou alterado.

## Situação atual

O responsável confirmou em 05/11/2026 que as 2 assinaturas ativas são de clientes reais. Portanto, **`lastro-hml` é produção, apesar do nome**. Não existe homologação de verdade.

Três consequências imediatas:

- Publicar o Gestão em `lastro-hml` é deploy em produção, e esse deploy não está autorizado.
- Preview da Vercel, testes remotos e contas de teste usam o mesmo banco dos clientes.
- A regra do [plano beta](beta-execution-plan.md) foi ultrapassada: dados financeiros reais só deveriam entrar depois de validar a recuperação, e hoje não há PITR nem backup.

## Opções

| Critério                  | A: criar homologação nova                 | B: criar produção nova e migrar              |
| ------------------------- | ----------------------------------------- | -------------------------------------------- |
| Clientes reais            | Não mudam de lugar                        | Migram com janela combinada                  |
| Risco imediato            | Baixo                                     | Alto: Auth, banco, arquivos e URLs           |
| Prazo para testar o Gestão | Curto                                    | Depende da migração                          |
| Nome dos recursos         | `lastro-hml` segue como produção          | Nomes corretos                               |
| Faturamento               | Conferir a conta de produção atual        | Conta nova, sem depender de avaliação        |
| Usuários                  | Sem exportação                            | Exige exportar usuários com dados sensíveis  |

## Recomendação

**Opção A agora, e B depois se o nome ou o faturamento justificarem.** Ela separa os ambientes sem mover cliente nenhum e libera a homologação do Gestão.

| Item             | Homologação (novo)           | Produção (`lastro-hml`, mantém)                |
| ---------------- | ---------------------------- | ---------------------------------------------- |
| Projeto Google   | `lastro-homolog`             | `lastro-hml`                                   |
| Firebase Auth    | Base própria, contas de teste | Base atual                                    |
| Firestore        | `(default)`, mesma região    | Atual, com proteção, PITR e backup a ativar    |
| Storage          | Bucket próprio               | Atual                                          |
| API              | `lastro-api-homolog`         | `lastro-api-hml`                               |
| Conta de serviço | Própria, sem acesso à produção | Atual                                        |
| Segredos         | Valores novos                | Atuais                                         |
| Frontend         | Projeto Vercel próprio       | Projeto Vercel `lastro-hml`                    |
| Dados            | Fictícios, nunca copiados    | Reais                                          |

Dados reais nunca são copiados para homologação.

## Fluxo de publicação

1. Preview e homologação apontam para o projeto novo. Hoje o Preview da Vercel fala com os dados dos clientes, e isso precisa mudar primeiro.
2. Homologação publica a branch candidata.
3. Produção só recebe uma versão aprovada, com a mesma imagem, promovida pelo digest.
4. **Push em `main` deixa de publicar direto em produção.** Hoje ele publica. Proposta: desligar a publicação automática de Production na Vercel e promover manualmente.

O deploy automatizado pode usar GitHub Actions com Workload Identity Federation e ambientes protegidos do GitHub, sem chave de conta de serviço guardada.

## Sequência de implantação

1. Proteger a produção atual: backup, PITR, alertas e conferência do faturamento.
2. Criar `lastro-homolog`, com Auth, Firestore, Storage e regras.
3. Criar o projeto Vercel de homologação e trocar as variáveis de Preview.
4. Desligar a publicação automática de Production.
5. Publicar a branch candidata em homologação, com dados fictícios.

Se a opção B vier depois, ela é um projeto próprio, com ensaio de migração em cópia e janela combinada com os clientes.

## Custos

O projeto novo fica barato: sem PITR, sem instância mínima, escala a zero. Os custos novos que importam estão na produção: PITR, backups e alertas. Estime em BRL no console antes de aprovar.

**Atenção ao faturamento:** o projeto foi criado com faturamento de avaliação. Com clientes reais, o fim dos créditos não pode derrubar o serviço. Confira saldo, validade e o tipo de conta no console.

## Aplicativos nativos

Quando houver publicação em lojas, perfis EAS separados apontam para cada ambiente, com identificadores distintos.
