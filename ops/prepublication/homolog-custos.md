# Lastro: custos da homologação

Levantamento de 05/11/2026, antes de qualquer provisionamento. **Nada foi criado.**

## Como ler estes valores

- Os preços em dólar vêm das páginas oficiais, consultadas nesta data.
- A tabela do Firestore mostrada na página pública é a da região padrão, e não a de São Paulo. `southamerica-east1` tende a custar mais. Por isso os totais abaixo são ordens de grandeza.
- A conta de faturamento é em BRL, e o valor final segue os SKUs em real. A API de catálogo de preços não está ativa no projeto. Confirme em [Cloud Platform SKUs](https://cloud.google.com/skus) ou na calculadora antes de aprovar.
- As conversões usam **R$ 6 por dólar, como hipótese de trabalho**.

## Resumo

| Item                                        | Mensal estimado           | Natureza                |
| ------------------------------------------- | ------------------------- | ----------------------- |
| Homologação, uso leve de uma pessoa         | US$ 0 a 2 (R$ 0 a 12)     | Variável                |
| Homologação parada                          | Centavos de dólar         | Armazenamento           |
| Proteção da produção, volume atual          | Abaixo de US$ 0,05        | Variável                |
| Vercel Pro, se exigido                      | US$ 20 por assento        | Fixo, decisão à parte   |

O orçamento sugerido para a homologação é de **R$ 50 por mês**, com avisos em 50%, 90% e 100%. Orçamento só avisa: ele não interrompe gastos.

## Homologação por serviço

| Serviço           | Franquia e preço                                                         | Uso previsto                 | Custo esperado             |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------- | -------------------------- |
| Firestore         | Por dia: 50 mil leituras, 20 mil gravações, 20 mil exclusões. 1 GiB      | Poucos MB, testes manuais    | Zero dentro da franquia    |
| Firestore além    | Padrão: US$ 0,03 por 100 mil leituras, US$ 0,09 por 100 mil gravações    | Só com teste de carga        | Evitar                     |
| Firebase Auth     | E-mail e senha, poucos usuários                                          | Até 10 contas                | Zero. Confirmar            |
| Cloud Run         | Por mês e **por conta de faturamento**: 180 mil vCPU-s, 360 mil GiB-s, 2 milhões de requisições | Mínimo 0 instâncias | Zero, somado à produção    |
| Cloud Build       | Franquia mensal. Cobrado por minuto além dela                            | Até 10 publicações           | Centavos. Confirmar        |
| Artifact Registry | Cobrado por GB armazenado. A produção já usa cerca de 372 MB             | Até 5 imagens                | Até US$ 0,20               |
| Cloud Storage     | Sem franquia gratuita garantida em `southamerica-east1`                  | Menos de 1 GB                | Centavos. Confirmar        |
| Secret Manager    | 6 versões ativas e 10 mil acessos por conta de faturamento. US$ 0,06 por versão além | 1 versão         | Zero                       |
| Cloud Scheduler   | Referência: 3 agendamentos grátis por conta, US$ 0,10 cada além          | 1 agendamento                | Zero. Confirmar            |
| Cloud Logging     | 50 GiB por projeto ao mês                                                | Muito abaixo                 | Zero                       |
| Uptime            | 1 milhão de execuções por projeto ao mês                                 | 1 verificação                | Zero                       |
| Métricas de log   | 150 MiB ao mês por conta de faturamento, depois US$ 0,258 por MiB        | 2 métricas                   | Zero                       |
| Alertas           | Grátis. Cobrança não antes de 01/09/2027: US$ 0,35 por métrica referenciada ao mês | 5 alertas          | Zero até lá                |

A regra de quais franquias valem por conta é importante: Cloud Run, Secret Manager e métricas são **somados à produção**, se os dois projetos usarem a mesma conta.

## Vercel

A equipe está no plano **Hobby**. Pelas [regras de uso da Vercel](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage), o Hobby é restrito a uso pessoal e não comercial, e todo uso comercial exige Pro ou Enterprise. A definição inclui receber pagamento para criar, atualizar ou hospedar o site.

**Isso já afeta a produção, com ou sem homologação.** O Lastro tem clientes reais em um projeto Hobby.

| Opção                                     | Custo                  | Efeito                                                     |
| ----------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Vercel Pro para a equipe (recomendada)    | US$ 20 por assento/mês | Regulariza produção e homologação no mesmo fluxo           |
| Hobby na homologação, Pro depois          | Zero agora             | Mantém a pendência e pode gerar bloqueio da conta          |
| Firebase Hosting só na homologação        | Franquia gratuita      | Difere do fluxo de produção, então testa menos a publicação |

Confirme a interpretação com a Vercel se houver dúvida. O plano Pro tem franquia própria e cobrança por uso além dela, e a Proteção por senha custa US$ 20 ao mês por projeto, opcional.

## Proteção da produção

Não é custo da homologação, mas precisa da mesma aprovação de gasto. Base: banco de 9 MB, ou 0,0085 GiB.

| Item                         | Preço padrão                    | Custo com 9 MB   | Custo com 1 GiB   |
| ---------------------------- | ------------------------------- | ---------------- | ----------------- |
| PITR                         | US$ 0,15 por GiB/mês            | Menos de US$ 0,01 | US$ 0,15 ao mês  |
| 7 backups diários            | US$ 0,03 por GiB/mês            | Menos de US$ 0,01 | US$ 0,21 ao mês  |
| 5 backups semanais           | US$ 0,03 por GiB/mês            | Menos de US$ 0,01 | US$ 0,15 ao mês  |
| Restauração para ensaio      | US$ 0,20 por GiB                | Menos de US$ 0,01 | US$ 0,20 por vez |
| Exportação pontual           | Leitura de documentos e bucket  | Centavos         | Centavos         |

PITR, backup e restauração não têm franquia gratuita. Desativar o PITR logo depois de ativar ainda pode gerar até um dia de cobrança. Um banco restaurado tem outro nome, então também não entra na franquia gratuita.

## Armadilhas de custo

| Risco                                | Como evitar                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| Instância mínima ligada              | Manter `--min-instances=0`                                      |
| CPU sempre alocada                   | Não usar `--no-cpu-throttling`                                  |
| Imagens acumuladas a cada publicação | Política de limpeza no Artifact Registry, guardando as 5 últimas |
| Teste de capacidade em ambiente real | **Não rodar.** Cada caso processa 20 mil fontes por quase uma hora. Fica no emulador |
| Build com máquina maior              | Usar a máquina padrão                                           |
| Banco restaurado esquecido           | Definir data de exclusão ao criar. Excluir exige aprovação      |
| Bucket de arquivos                   | Exclusão reversível guarda objetos por 7 dias, com cobrança     |
| Fim dos créditos de avaliação        | Confirmar saldo e validade: créditos não tornam isso gratuito   |

## Fontes consultadas em 05/11/2026

- [Firestore](https://cloud.google.com/firestore/pricing)
- [Cloud Run](https://cloud.google.com/run/pricing)
- [Google Cloud Observability](https://cloud.google.com/stackdriver/pricing)
- [Secret Manager](https://cloud.google.com/secret-manager/pricing)
- [Cloud Scheduler](https://cloud.google.com/scheduler/pricing), sem confirmação do valor na página nesta consulta
- [Planos da Vercel](https://vercel.com/docs/plans/hobby)
