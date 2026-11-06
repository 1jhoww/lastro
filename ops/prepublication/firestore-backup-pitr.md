# Proposta: backup e PITR do Firestore

Nada aqui foi executado. Os comandos alteram `lastro-hml`, que é produção, e custam dinheiro: exigem autorização do responsável.

## Recomendação

Ativar as duas proteções antes de publicar as bonificações. O custo atual fica abaixo de US$ 0,03 por mês, e a primeira bonificação real impede reverter a API.

| Proteção | Configuração | Para quê |
|---|---|---|
| PITR | 7 dias, versão por minuto | Erro recente: dado apagado ou gravado errado |
| Backup diário | Retenção de 5 semanas | Erro notado no fechamento do mês |
| Backup semanal | Domingo, retenção de 14 semanas (máximo) | Erro notado tarde, e perda do banco |

## Situação em 6 de novembro de 2026

Consulta somente leitura em `lastro-hml`:

| Item | Estado |
|---|---|
| Banco | `(default)`, Standard, `southamerica-east1` |
| Tamanho (dados e índices) | 9,39 MB |
| PITR | Desativado; recuperação só da última hora |
| Agendamentos e backups | Nenhum |
| Proteção contra exclusão do banco | Ativa |
| Storage | Exclusão reversível de 7 dias; sem versionamento |

## Custo estimado

Preços da tabela pública do Google para São Paulo, Standard, em dólares.

| Item | Preço |
|---|---|
| PITR | US$ 0,225 por GiB/mês |
| Backup | US$ 0,045 por GiB/mês |
| Restauração | US$ 0,30 por GiB |
| Clone | US$ 0,3176 por GiB |

Backups não têm franquia. Com 35 diários e 14 semanais, a empresa guarda 49 cópias do banco.

| Tamanho do banco | PITR/mês | Backups/mês | Total/mês | Uma restauração |
|---|---:|---:|---:|---:|
| 9,39 MB (hoje) | US$ 0,002 | US$ 0,019 | US$ 0,02 | US$ 0,003 |
| 100 MB | US$ 0,02 | US$ 0,22 | US$ 0,24 | US$ 0,03 |
| 1 GiB | US$ 0,23 | US$ 2,21 | US$ 2,43 | US$ 0,30 |
| 10 GiB | US$ 2,25 | US$ 22,05 | US$ 24,30 | US$ 3,00 |

A conta de backups é um teto: cada cópia é cobrada pelo tamanho do banco no dia dela, e o banco era menor nos dias antigos. Leituras durante uma recuperação são cobradas como leituras normais. O alerta de orçamento de R$ 100 continua adequado enquanto o banco ficar perto de 1 GiB. Reveja a retenção se ele passar disso.

## Ativação

Ordem: PITR primeiro, porque a janela de 7 dias só começa a contar a partir da ativação.

```bash
gcloud firestore databases update --database='(default)' --enable-pitr --project=lastro-hml --configuration=lastro-hml
```

```bash
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=5w --project=lastro-hml --configuration=lastro-hml
```

```bash
gcloud firestore backups schedules create --database='(default)' --recurrence=weekly --day-of-week=SUN --retention=14w --project=lastro-hml --configuration=lastro-hml
```

Conferência, no dia seguinte:

```bash
gcloud firestore databases describe --database='(default)' --project=lastro-hml --configuration=lastro-hml --format="value(pointInTimeRecoveryEnablement,earliestVersionTime)"
```

```bash
gcloud firestore backups list --location=southamerica-east1 --project=lastro-hml --configuration=lastro-hml
```

O horário do backup não é escolhido. PITR não afeta leitura nem escrita, segundo o Google.

## Restauração

A escolha depende do tamanho do estrago.

### Poucos registros errados

Use leitura em um minuto passado, dentro dos últimos 7 dias, e grave de volta só o que foi afetado. Hoje não existe script pronto: cada caso exige um script revisado, com autorização própria.

### Banco inteiro

1. Pare as escritas: suspenda o tráfego da API.
2. Escolha a origem: PITR até 7 dias, ou o backup mais recente antes do erro.
3. Restaure em um banco novo. Restauração nunca grava sobre o banco original.

Do backup:

```bash
gcloud firestore databases restore --source-backup=projects/lastro-hml/locations/southamerica-east1/backups/BACKUP_ID --destination-database=lastro-restauracao --project=lastro-hml --configuration=lastro-hml
```

Do PITR, com horário em minuto exato:

```bash
gcloud firestore databases clone --source-database='projects/lastro-hml/databases/(default)' --snapshot-time=2026-11-06T12:00:00.00Z --destination-database=lastro-restauracao --project=lastro-hml --configuration=lastro-hml
```

4. Acompanhe a operação:

```bash
gcloud firestore operations list --database=lastro-restauracao --project=lastro-hml --configuration=lastro-hml
```

5. Confira contagens de pedidos, títulos e reconciliação de estoque no banco novo.
6. Aponte a API para o banco novo. Índices vêm com o backup; regras de segurança e TTL não vêm, então reaplique os dois.
7. Libere o tráfego e registre o que foi perdido entre o ponto restaurado e a parada.

## Limites que continuam

- **A API só usa o banco `(default)`.** O passo 6 exige uma variável nova para escolher o banco. É uma mudança pequena, ainda não feita. Enquanto ela não existir, a recuperação total depende de um deploy de emergência.
- **Storage e Authentication ficam de fora.** Backup do Firestore não copia logos, fotos nem contas de login. O Storage tem 7 dias de exclusão reversível. Authentication não tem cópia.
- **Sem alerta de falha.** O projeto não tem política de alerta; confira a lista de backups uma vez por semana até criar uma.
- **Backups ficam na mesma região e no mesmo projeto.** Eles sobrevivem à exclusão do banco, mas não à perda do projeto.

## Teste de restauração

Faça um uma vez, logo depois da primeira cópia, para medir o tempo real. Restaure em `lastro-restauracao-teste`, confira as contagens e apague esse banco. Custo atual: menos de US$ 0,01. O teste cria um banco temporário em produção e exige autorização própria.

## Decisões necessárias

1. Autorizar os três comandos de ativação.
2. Autorizar o teste de restauração.
3. Decidir se a variável de banco entra junto com as bonificações ou depois.

## Fontes

- [Preços do Firestore](https://cloud.google.com/firestore/pricing)
- [Cobrança do Firestore](https://firebase.google.com/docs/firestore/pricing)
- [Visão geral do PITR](https://docs.cloud.google.com/firestore/native/docs/pitr)
- [Backups e restauração](https://docs.cloud.google.com/firestore/native/docs/backups)
