# Lastro: separação entre homologação e produção

Proposta. Nenhum recurso foi criado ou alterado.

## Situação atual

Há um só ambiente, `lastro-hml`. O alvo Production da Vercel significa "frontend principal de homologação". Preview, Production e testes dividem o mesmo banco, a mesma API e a mesma base de usuários.

Isso impede três coisas: testar sem risco para quem já usa, recuperar dados sem afetar todos, e dar permissões diferentes para quem opera cada ambiente.

## Decisão que vem primeiro

As 2 assinaturas ativas em `lastro-hml` são de clientes reais?

- **Não:** crie a produção vazia. `lastro-hml` continua como homologação.
- **Sim:** essas empresas precisam migrar para a produção nova com janela combinada. Até lá, trate `lastro-hml` como produção: backup antes de tudo, e testes só em empresa de teste.

## Modelo proposto

| Item              | Homologação (mantém)              | Produção (novo)                                   |
| ----------------- | --------------------------------- | ------------------------------------------------- |
| Projeto Google    | `lastro-hml`                      | `lastro-prod`, em projeto próprio                 |
| Firebase Auth     | Base própria                      | Base própria, sem contas de teste                 |
| Firestore         | `(default)`                       | `(default)`, mesma região, proteção, PITR, backup |
| Storage           | `lastro-hml.firebasestorage.app`  | Bucket próprio, mesma região                      |
| API               | `lastro-api-hml`                  | `lastro-api-prod`, mínimo de 1 instância          |
| Conta de serviço  | `lastro-api-hml@`                 | `lastro-api-prod@`, sem acesso a homologação      |
| Segredos          | `lastro-invitation-secret`        | Valores novos, nunca copiados                     |
| Jobs              | `lastro-recurring-hml`            | `lastro-recurring-prod`, `lastro-billing-prod`    |
| Frontend          | Projeto Vercel `lastro-hml`       | Projeto Vercel próprio, domínio definitivo        |
| Observabilidade   | Alertas básicos                   | Alertas com canal de plantão                      |
| Orçamento         | Atual                             | Separado                                          |
| Dados             | Fictícios                         | Reais, nunca copiados para homologação            |

Projetos separados são o único limite que o IAM garante de verdade: uma conta de serviço de homologação não alcança produção por engano, e quotas, custos e auditoria ficam isolados.

## Fluxo de publicação proposto

1. `main` publica em homologação, como hoje.
2. Produção só recebe uma versão marcada, por exemplo `v1.2.0`, com aprovação manual.
3. A imagem da API é a mesma que passou em homologação, promovida pelo digest. Nada é reconstruído.
4. O frontend de produção não publica por push em `main`.
5. Preview ganha variáveis próprias, para não falar com produção.

O deploy automatizado pode usar GitHub Actions com Workload Identity Federation, sem chave de conta de serviço guardada. Ambientes protegidos do GitHub exigem aprovador para produção.

## Aplicativos nativos

Quando houver publicação em lojas, perfis EAS separados apontam para cada ambiente, com identificadores de aplicativo distintos para homologação e produção.

## Sequência de implantação

1. Decidir o destino das 2 assinaturas ativas.
2. Criar o projeto `lastro-prod`, com faturamento e orçamento próprios.
3. Criar Firestore, Auth, Storage e regras.
4. Ativar proteção contra exclusão, PITR e backup antes do primeiro dado.
5. Ensaiar a restauração em banco temporário.
6. Publicar índices, API e frontend em produção.
7. Executar a validação remota com contas de teste.
8. Liberar a primeira empresa.

Se houver clientes reais em `lastro-hml`, a migração vira uma etapa própria entre 7 e 8. Exportação de usuários do Auth inclui dados sensíveis, então precisa de plano e autorização separados.

## Custos

Projeto novo não tem custo em si. Custos novos: instância mínima da API, PITR, backups, armazenamento e alertas. Estime em BRL na calculadora do Google antes de aprovar. Os créditos de teste não valem como orçamento de produção.

## Enquanto isso

O Gestão pode ser homologado em `lastro-hml` com uma empresa de teste, sem esperar a separação. O que não deve acontecer é considerar `lastro-hml` produção comercial sem backup restaurável.
