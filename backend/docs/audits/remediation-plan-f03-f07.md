# Plano posterior de correção F03–F07

Registro histórico do plano de 09/10/2026. A rodada local iniciada em 13/10/2026 está documentada em [correção consolidada](remediation-f03-f07-2026-10-13.md) e [operação técnica](../operations-f03-f07.md). As restrições desta rodada vêm do pedido atual do usuário; as instruções de aguardar F02 abaixo pertencem ao checkpoint anterior.

Status: plano técnico, sem implementação nesta rodada. Ordem imediata autorizada: corrigir F01, apresentar F02 e aguardar aprovação de F02. Os itens abaixo precisam de execução/aceite antes da homologação externa ou de uma exceção documentada com controle equivalente. Não autorizam deploy, recursos pagos, produção ou alteração de outro projeto.

## F03: proteção HTTP e custo de caminhos públicos

Responsável: backend; decisão de ingress com infraestrutura.

Implementar limitador barato anterior ao parsing privado, mantendo o tratamento seguro de JSON e o limite de corpo. Separar probes de prontidão de um caminho público que dispara uma leitura por chamada; propor cache curto/limite e ingress apropriado. Não exigir autenticação que torne probes inválidos. Revisar chaves IPv6/trusted proxy e writes de contadores já excedidos sem abrir bypass da limitação distribuída.

Critérios de aceite:

- JSON inválido, corpo excessivo e conteúdo rejeitado consomem cota barata e chegam a `429`, sem leitura/escrita econômica.
- Readiness continua útil para probes; abuso público não gera leituras Firestore ilimitadas por requisição. Testar falha/lentidão do banco.
- Limitação de catálogo antes do parser permanece, sem exposição de tenant/dados privados e sem segredo no erro.
- Chaves de IP confiáveis no caminho de proxy homologado; teste de spoofing/IPv6 e múltiplas instâncias.
- Medir contenção/custo dos contadores privados e por slug; registrar limites e alertas, sem alegar capacidade por emulador.

## F04: retenção e limpeza

Responsável: backend e operação de dados; política com proprietário do negócio.

Definir retenção por coleção/objeto antes de adicionar TTL ou exclusão. Contadores temporários já têm Timestamp; idempotências temporárias da plataforma usam ISO e precisam de campo apropriado/migração aprovada. Planejar limpeza de objetos antigos ou órfãos de imagens com verificação de referências atuais e revisão de corridas.

Critérios de aceite:

- Plano explicita o que pode expirar, prazo, recuperação e custo; ledger, prova e idempotência financeira não recebem exclusão automática.
- TTL usa Timestamp em coleções aprovadas e tem configuração declarada; teste de expiração lógica independente da exclusão assíncrona.
- Migração de campo textual tem dry-run/checkpoint e preserva contratos/replay conforme política aprovada.
- Cleanup não apaga imagem atualmente vinculada ou upload concorrente. Falha de cleanup fica registrada e retomável.
- Inventário de armazenamento/crescimento e procedimento operacional aprovados; nenhuma limpeza real agora.

## F05: orçamento de processamento/memória

Responsável: backend; orçamento/SLO com infraestrutura após medição.

Separar timeout de recebimento HTTP de prazo de processamento. Limitar concorrência/materialização e medir páginas grandes, fontes/provas, imagens, geração e revalidação de documentos. Cooperar com SDK lento sem presumir rollback após timeout. Integrar a recuperação de F02 onde houver efeitos financeiros.

Critérios de aceite:

- Orçamentos por operação com métricas de bytes, RSS, latência e leituras; nenhum array/caching ilimitado em novas execuções.
- Documentos/exportações incluem leitura e revalidação no orçamento operacional; concorrência por instância e backpressure explícitos.
- Testes de falha antes/depois do commit, resposta perdida, cliente desconectado e SIGTERM distinguem aplicação de ausência de resposta.
- Páginas de 100 pedidos/títulos de origem e pedidos de até 200 produtos não causam crescimento descontrolado sob concorrência homologada.
- Não implementar a proposta de snapshots grandes nem alterar payload de consultas sem aprovação contratual.
- Validar Linux/SDK/serviço real em homologação autorizada; não anunciar SLO de 100 usuários apenas pelos emuladores.

## F06: runtime e artefato

Responsável: backend e responsável pelo artefato de homologação.

Fixar LTS corrigido e suportado; rever `engines` para não aceitar linhas obsoletas por faixa ampla. Validar runtime/OpenSSL, Sharp, fontes e licença no artefato Linux. Auditoria npm continua separada do runtime e pode ser repetida no registry autorizado, sem código/segredos.

Critérios de aceite:

- Runtime e dependências nativas registrados com versão/SBOM; versões aceitas não incluem linha sem suporte.
- Reexecutar TypeScript, lint, formatação, build e suíte completa sem atualização silenciosa de contratos.
- Smoke test local do artefato inclui fontes empacotadas, PDFs/CSV e imagens; empacotar somente `dist` não recebe aceite.
- Analisar alcançabilidade dos avisos oficiais, sem transformar todo CVE do runtime em exploração demonstrada do aplicativo.
- Não fazer deploy ou atualizar runtime nesta rodada F01/desenho F02.

## F07: esquemas de saída OpenAPI

Responsável: backend; contrato com Claude.

Separar conversão de entrada e saída no gerador. Revisar defaults, transforms, campos removidos e binários. Regenerar JSON/tipos sem misturar esse ajuste com a mudança estrutural F02 antes de aprovação.

Critérios de aceite:

- Campo materializado como `schedule[].weight` é obrigatório na resposta e opcional na entrada quando existir default.
- Respostas reais representativas passam contra esquema de saída; não só igualdade do gerador com o arquivo salvo.
- Rotas, operationIds, permissões, headers, envelopes, CSV/PDF e status de erro continuam correspondentes.
- Registrar diferenças de tipos e política de versão; atualizar o contrato do frontend sem quebrar requests anteriores válidos.

## Gate de homologação

F01 validado e F02 aprovado/implementado/testado são pré-requisitos da integração financeira final. F03–F07 precisam dos critérios acima antes de homologação externa. Acrescentar IAM, TLS/proxy/CORS, backup/restauração, retenção, índices, logs e orçamento de custo ao gate de infraestrutura. Nenhum item pendente recebe aprovação tácita porque os testes locais passaram.
