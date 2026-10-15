# Segurança das Fases A, B, C e D

Atualização local F03–F07 em 13/10/2026: os controles atuais de parser, readiness, proxy, retenção, imagens, budgets e runtime estão em [operação técnica](operations-f03-f07.md). Trechos de fases anteriores preservam decisões históricas; a especificação operacional atual prevalece nos pontos alterados. TTL e configuração Cloud Run não foram implantados.

Referências: [OWASP ASVS 5.0.0 nível 2](https://owasp.org/projects/asvs), [API Security Top 10 2023](https://devguide.owasp.org/en/07-training-education/07-api-top-ten/), [Firebase ID Tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [emuladores](https://firebase.google.com/docs/emulator-suite/connect_auth). É uma verificação parcial da fundação, não certificação completa, pentest ou declaração de invulnerabilidade.

## Ameaças e controles

| Referência / ameaça                 | Implementação                                                                                                      | Evidência / limite                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| API1 BOLA / IDOR                    | Contexto empresarial validado e referências dentro do tenant; não há busca arbitrária global de usuário.           | Testes de header, UID e tentativa A→B.                                             |
| API2 autenticação                   | SDK oficial, verificação de revogação em toda API, estado global e vínculo atual.                                  | Tokens malformados, expirados, audiência/emissor diferente, identidade desativada. |
| API3 propriedades / mass assignment | Zod strict em entradas e projeções de saída permitidas; body/query/path validados.                                 | Campos tenantId, permissões e papel de plataforma rejeitados.                      |
| API4 consumo excessivo              | JSON 64 KiB; paginação 25/100; limites por IP e convites por ator.                                                 | Teste 413/429 e limite distribuído; não há garantia contra ataque volumétrico.     |
| API5 autorização por função         | Escopo obrigatório por rota; perfis separados da plataforma.                                                       | Vendedor não gerencia usuários; empresa não gerencia planos.                       |
| API6 abuso de fluxos                | Vaga reservada, expiração, revogação e consumo único; versões e idempotência.                                      | Corridas de convites, aceitação dupla e último administrador.                      |
| API7 SSRF                           | Nenhuma rota busca URL, imagem ou webhook fornecido pelo usuário.                                                  | Reavaliar em documentos, uploads e integrações futuras.                            |
| API8 configuração                   | Emuladores somente em demo/local; produção rejeita emulador, exige HTTPS/origens/segredo; Security Rules deny-all. | Testes de configuração; IAM/ingress produtivos não configurados.                   |
| API9 inventário                     | Registro único de rotas implementadas gera OpenAPI; docs apenas em desenvolvimento.                                | Contrato e tipos gerados; sem rotas comerciais fictícias.                          |
| API10 dependências externas         | SDK oficial, schemas de persistência e falha fechada; lockfile e audit npm.                                        | Audit atualizado, mais teste de falha sanitizada.                                  |
| XSS / injeções                      | Nenhuma interpolação de query Firestore, chave de documento validada, schemas e CSP/nosniff.                       | Não há renderização de conteúdo do usuário; frontend/CSV/PDF serão reavaliados.    |
| CSRF                                | API só aceita Bearer em header, sem autenticação por cookie e sem credenciais automáticas em CORS.                 | Se cookies forem introduzidos, implementar CSRF antes de ativá-los.                |
| Replay                              | Convite single-use; criação com chave e hash; PATCH com versão esperada.                                           | Não impede utilização de token roubado.                                            |
| Segredos/logs                       | Chave local ignorada; secret obrigatório em produção; logs sem token/body/query/email/stack.                       | Verificação local por assinaturas, não cobertura completa de detecção de segredos. |

## Fronteiras de confiança

Cliente não define permissões, tenant autorizado, contadores, preços de plano ou status de assinatura. Seleção de empresa é candidata e depende de vínculo. Firebase prova UID; aceitação de convite ainda consulta email atual/verificado no provedor. Super Admin é provisionado fora da API; usuário empresarial não pode editar o registro de plataforma. O servidor compartilhado acessa Firestore como serviço privilegiado e aplica isolamento explicitamente.

## Limites operacionais

Local usa rate limiting em memória para o volume HTTP por IP. O modo produtivo já contém contador Firestore por IP/janela e o limite de convites usa contador compartilhado por UID/janela (30 por hora) em ambos os modos. O controle produtivo funciona de forma fechada se o banco falhar, mas sua latência, custo e contenção ainda não foram medidos. CIDRs/ingress, trusted proxy e proteção volumétrica exigem revisão antes de publicação. IPv6/origens distribuídas podem contornar um orçamento por IP; um futuro limite por tenant/operação deverá complementar os módulos comerciais.

## Bootstrap da plataforma

`seed-local.ts` recusa projeto real e cria apenas operador fictício local com senha aleatória. Não há endpoint de autoatribuição. A atribuição em produção deverá ocorrer por procedimento aprovado: UID previamente conhecido e verificado, executor humano com identidade auditável, MFA, mudança revisada, escrita restrita em `platformAdmins`/`identities`, auditoria e retirada da permissão temporária do executor. Este procedimento não foi executado contra serviço real; o seed local não é ferramenta de bootstrap produtivo.

## Dependências

`package-lock.json` fixa a resolução. TypeScript 5.9.3 foi escolhido por compatibilidade declarada de typescript-eslint e openapi-typescript; não foi usado force/legacy-peer-deps. Overrides de chokidar 4, basic-ftp 6.2.2+, PubSub 6.2+, uuid 11.1.1+ na cadeia gaxios e re2 1.27+ corrigem avisos transitivos do Firebase CLI. O CLI é ferramenta de desenvolvimento; a compatibilidade validada nesta entrega é Auth + Firestore + Storage Emulator. Outras funções do CLI não são parte desta fase e precisam de validação própria. Não modificar manualmente node_modules para esconder avisos.

Política proposta: audit completo e de runtime em toda alteração de dependências e revisão semanal; achados críticos/altos bloqueiam publicação até correção ou tratamento formal aprovado. Revisar atualizações de SDK/runtime mensalmente e aplicar correções relevantes prioritariamente. Reexecutar build e testes após lockfile/overrides mudar. A verificação local de segredos não substitui scanner dedicado em CI; CI externo não foi configurado.

## Riscos residuais e pendências produtivas

- Comprometimento do backend/conta de serviço pode alcançar múltiplas empresas; organização por caminho não oferece segregação IAM por documento.
- Emulador Auth aceita tokens sem assinatura: testes validam formato, datas, issuer/audience e políticas; não comprovam a validação criptográfica contra certificados de produção. Produção usa o mesmo verificador oficial, com flags de emulação recusadas.
- Sem MFA imposta pelo backend nesta fase. Plataforma exige login recente; MFA, política de recuperação e proteção da identidade administrativa deverão ser verificadas antes de produção.
- Secret local é arquivo ignorado e não equivale a Secret Manager. Windows ACL, logs de emuladores e diretório .local devem ficar restritos ao operador. A entrega única de senha pelo seed local é um fluxo de operador, não log da API.
- Renovação de segredo invalida a recomposição de convites pendentes; definir rotação com chaves versionadas antes de operação contínua. Tokens existentes apresentados ainda são comparados ao hash persistido até expirar/revogar.
- Revogação/limites/suspensão bloqueiam a próxima autorização e são relidos nas transações; requisições de leitura já em andamento não são canceladas automaticamente.
- Auditoria é append-only pela API, mas a conta de serviço tem capacidade no banco; retenção imutável independente depende de infraestrutura aprovada.
- TTL de rateLimits/idempotência não está habilitado; definir retenção/limpeza e custos. Não remover idempotência sem revisar replay.
- Backups, recuperação, App Check, Armor, alertas, SLOs e capacidade para 100 usuários não foram configurados/comprovados.
- Nenhuma condição especial da Daiane foi presumida. Os valores especiais em testes são exclusivamente sintéticos.

Responsável pelos controles de produto: Hepta Studios. Aceitação de risco alto/crítico requer decisão explícita com responsável, motivo, controles compensatórios e validade. Não há autorização implícita para publicar com risco conhecido.

## Ameaças adicionais da Fase B

Carteira é propriedade verificada no servidor. Listagem do vendedor inclui assignedTo=UID; leitura/edição por ID confirma propriedade, inclusive em transações. Transferência exige versão/auditoria e vendedor com identidade/vínculo ativos na mesma empresa. Desativação/reativação é administrativa. Reservas de documento/SKU são transacionais por empresa. Documento/contatos/notas não aparecem na auditoria. Hash de CPF não anonimiza dados de baixo espaço de busca; reservas continuam dados pessoais.

Preço só é aceito como comando do administrador autorizado, nunca como total/saldo. Vendedor não escreve produto/categoria/imagem/catalogVisible. Busca usa campos/ordem predefinidos, prefixo indexado, página limitada e cursor assinado ao contexto; sem query arbitrária ou varredura completa.

Upload: JPEG/PNG/WebP conferidos por decoder sharp, 5 MiB, 16 milhões de pixels/lado 8192, sem animação e recodificação WebP sem metadados. SVG, URL e nome/caminho original não entram no Storage. Limite compartilhado de 30 tentativas/hora por UID e limite global HTTP. Sharp é dependência nativa sujeita a falhas desconhecidas; atualizar e medir consumo sob carga. Downloads normais ocupam até 5 MiB por fluxo; memória/concorrência produtivas ainda não foram medidas.

Objetos privados: Firebase Storage Rules negam acesso direto, API deriva tenant/produto/UUID, sem download token ou URL pública. Leitura verifica assinatura, vínculo e produto ativo para vendedor; respostas privadas/no-store e nosniff. SDK privilegiado ignora Rules; IAM/bucket GCS requerem revisão antes de produção. Emuladores têm APIs administrativas abertas e não podem ser expostos publicamente. Ambas as variáveis FIREBASE_STORAGE_EMULATOR_HOST/STORAGE_EMULATOR_HOST são recusadas em produção; modo local força loopback e bucket demo.

Storage e Firestore não têm transação conjunta. Falha tenta remover objeto da tentativa perdedora; interrupção pode deixar órfãos. Imagens removidas/substituídas permanecem privadas, inacessíveis pela API. Sem job de limpeza nesta fase: definir retenção/rotina antes de produção. Publicação futura deve usar área/domínio público separados com campos/imagens autorizados e retirada quando produto/assinatura deixar de permitir; não foi implementada.

CPF/CNPJ validado matematicamente não comprova situação cadastral. Não houve serviço de consulta fiscal externo. IAM, certificados produtivos, custo e capacidade não são comprovados pelo emulador. Nenhuma credencial produtiva ou recurso pago foi utilizado.

## Ameaças e riscos do estoque — Fase C

Estoque e movimentos pertencem ao caminho autorizado do tenant e produto, com permissão administrativa para escrita/histórico/reposição/reconciliação. Vendedor recebe DTO só com disponibilidade de ativos. TenantId, ator, tipo/origem, físico/reservado/disponível e sequência fornecidos pelo cliente são rejeitados. Ajustes recebem variação, não saldo final calculado pelo frontend. Assinatura e vínculo são relidos na transação, inclusive em replay.

Entrada/ajuste cria saldo, movimento, operação idempotente e auditoria num único commit. UUID não concede permissão; chave é única no tenant, vinculada a comando/ator. Duplicata devolve snapshot original, não saldo atual. Alteração de quantidade, produto, tipo ou ator gera conflito. Registro não expira nesta fase; limpeza incorreta reabre risco de replay e só pode ser adotada com política formal.

Inteiros escalados e limites preservam físico≥reservado≥0; versão evita ajuste contra saldo desatualizado. Mínimo/flag/quantidade de reposição são projeções transacionais. Unidade bloqueada após histórico. C preparou contratos sem origem fictícia; D agora integra pedidos/reservas/expedição/liberação legítimos, mantendo devolução fora do escopo.

## Ameaças e riscos dos pedidos — Fase D

Pedido exige tenant/vínculo/identidade/assinatura atuais, operação/perfil/responsável/carteira/estado no mesmo snapshot transacional. Vendedor não cancela/aplica descontos/escolhe responsável; não recebe dados de pedido alheio ou cliente transferido. Novo vendedor não herda histórico do responsável anterior; administrador preserva acesso. Lista filtra responsável no índice e confere carteira por candidato, sem varrer para completar página. Acesso negado a recurso empresarial usa 404 seguro.

Payload não define preço/subtotal/total/saldo/reserva/origem/ator/estado. Produtos ativos relidos, quantidade validada conforme unidade C e cálculo inteiro BigInt com limites monetários. Aprovação administrativa de desconto vincula versão e condições; edição invalida, mudança de preço exige reaprovação, aprovador desativado/rebaixado não autoriza. Condição explícita/datas reais no fuso, parcelas determinísticas, snapshots confirmados preservados.

Confirmação une pedido/reservas/movimentos/saldos/recebíveis/guard/evento/auditoria/idempotência num commit. Adapter valida pedido persistido/versão/linha e identidade reserva por tenant/pedido/linha/produto; não aceita liberar/expedir outra reserva. Falha após staging não deixa efeitos parciais; corridas por última unidade/mesma chave/transições exercitadas. Mantêm cadeia/reconciliação C; hashes não impedem reconstrução por credencial privilegiada.

Confirm/dispatch/cancel exigem UUID/chave/payload/ator e versão, com resultado original retido sem TTL. Chave divergente é conflito; replay relê autorização atual. Dados persistidos inválidos falham fechados com erro interno sanitizado. API não edita histórico nem saldos financeiros. POST rascunho não é idempotente e pode duplicar intenção se retentado cegamente; documentado no frontend.

Cancelamento confirmado lê parcelas esperadas/guard e busca limitada de pagamentos; qualquer evidência financeira bloqueia, sem apagar recebimentos ou presumir devolução/crédito. Cooperação futura depende de pagamentos atualizarem guard e recebível na mesma transação; o contrato E é obrigatório para manter a barreira contra corrida. Não há pagamentos operacionais nesta fase; fixtures via SDK apenas exercitam bloqueios. Expedido é terminal até fluxo próprio de devolução.

Sem limite comercial de linhas ou pedido mínimo. JSON 64 KiB, pré-validação de documento 1 MiB e limites reais de commit/tempo do banco permanecem. Rejeições são integrais, sem confirmação repartida. Rascunhos incompletos são privados ao responsável/admin e não geram reservas/recebíveis. Descrição/snapshots e páginas de até cem pedidos podem gerar respostas maiores; medir memória, custo e latência sob carga real. Cada produto disputado é ponto de contenção; emulador não comprova distribuição produtiva, custo, 100 usuários/SLO, índices implantados, backups/restauração ou disponibilidade. IAM/TLS/MFA/segredos/retencão/Armor/App Check continuam dependentes de aprovação e risco/custo. Sem serviço novo, produção, dependência nova ou recurso pago.

Operador privilegiado pode corromper/apagar pedidos/reservas/recebíveis/guard. Leituras validam caminho/schema e bloqueiam divergências conhecidas; isso não substitui auditoria externa, inventário financeiro/reconciliação completa e recuperação testada. Guard por pedido pode ter contenção futura com pagamentos; medir antes de ampliar. Segurança ASVS/API Top 10 é referência parcial, sem declaração de invulnerabilidade.

Histórico é imutável pela API e hash encadeado detecta alterações acidentais, lacunas/duplicatas e inconsistência matemática na reconciliação. Conta de serviço comprometida pode reconstruir a cadeia e saldos; isto não substitui IAM, retenção independente e backups consistentes. Ausência de agregado é interpretada como legado zero: exclusão por operador após movimentos é corrupção, não rotina de limpeza; restauração deve reconciliar dados antes de liberar acesso. Reconciliação não faz reparo automático.

Consultas paginadas e limitadas evitam varreduras operacionais; reconciliação é linear no histórico de um produto, fracionada em páginas. Estoque movimentado durante reconciliação exige reinício; produto continuamente disputado pode precisar de snapshot/export de auditoria em etapa futura. Contenção num produto pode provocar retries/conflitos; custo/latência/capacidade ainda exigem medição real. Não adicionar sharding ou serviços pagos sem evidência/aprovação.

Permissões produtivas, certificados, recuperação, backups, retenção, SLOs e capacidade para 100 usuários continuam sem comprovação produtiva. Emuladores e falhas sintéticas verificam invariantes nos cenários exercitados, sem pentest/ASVS completo ou garantia de invulnerabilidade.

## Fase E: controles vigentes e riscos residuais

Financeiro exclusivamente administrativo, com permissão específica e autenticação recente para estorno, cancelamento, restituição manual e retorno. Serviços relêem contexto atual antes do commit e replay. Recebimento não aceita excesso, saldo/ator/tenant impostos nem títulos de pedidos diferentes. Forma efetiva é validada independentemente da prevista; desativação não altera snapshot histórico. Dinheiro inteiro, pesos BigInt e conservação dos componentes bloqueiam inconsistências.

Cancelamento/retorno prova a origem de crédito e caixa, restaura fontes já aplicadas sem duplicar outras aplicações e só destina caixa liquidado. Alocações transferidas deixam de ser reversíveis. Obrigação manual não comprova dinheiro devolvido; confirmação exige referência/motivo/forma/data/versão. A veracidade externa do comprovante ainda depende do operador e conciliação bancária; API não integra banco.

Intenção de retorno bloqueia novas liquidações/estornos/aplicações conflitantes daquele pedido. Guard por linha reserva limite físico e prova valores cumulativos no evento imutável. Quantidade recebida por qualidade é auditável; danificado exige decisão explícita e não entra em disponível. Histórico/expedição/snapshots D são preservados. Dado corrompido ou legado com dinheiro sem origem exige revisão, nunca reparo silencioso.

Aceite monetário parcial/zero de dano é restrito a administrador com autenticação recente e às quantidades recebidas ainda não resolvidas. Preview é consulta administrativa; resolução relê versões e limite, negando valores acima do delta cumulativo. Redução é parte do snapshot e da prova imutável do guard; novas devoluções não reutilizam valor rejeitado. Decisão negativa não admite valor positivo. Não há alteração direta de saldo, qualidade concluída ou destino já consumido.

## Fase G - documentos e exportações

Seis downloads privados usam autenticação, vínculo/assinatura atual e permissões existentes. Documento exige pedido próprio/carteira atual para vendedor. Revalidação depois da renderização impede entregar resultado após revogação ou alteração de pedido/retorno. Uma autorização não pode revogar bytes já entregues; frontend controla retenção e compartilhamento local. Plataforma não recebe acesso transversal.

PDFKit compõe texto com fontes locais licenciadas, sem HTML, JavaScript PDF, URL remota, template enviado pelo cliente, navegador ou Storage. IDs opacos validados geram filename ASCII; nenhum nome empresarial/cliente entra em header ou caminho. PDFs e CSVs usam attachment, no-store e nosniff. Erros são JSON seguro, nunca resposta parcial de documento.

PDF conserva 8 MiB/100 páginas/dez segundos de renderização. F05 acrescenta prazo total de 30 segundos e duas vagas compartilhadas por PDF/CSV, incluindo leitura e revalidação. SDK pendente conserva vaga após timeout/desconexão. CSV conserva 100 clientes/produtos ou dez pedidos/títulos e 1 MiB. Listagens resolvem snapshots incrementalmente, com quatro vagas e orçamento acumulado de leitura; página excessiva retorna erro inteiro e exige `limit` menor. Não há fila ilimitada. Cota de download permanece 30/usuário/hora em rateLimits. Memória/concorrência por instância não certificam carga produtiva.

CSV projeta somente campos permitidos, escapa aspas/delimitadores/quebras de linha e prefixa apóstrofo para fórmulas =,+,-,@ após whitespace, incluindo controles iniciais. Controle não imprimível é removido antes de detectar fórmula. Não remover essa proteção no frontend. UTF-8/BOM preserva acentos. Paginação autenticada evita trocar tenant/filtros/usuário por cursor; página não é relatório global imutável.

G não cria coleção comercial, objetos Storage ou URLs públicas. Fontes devem acompanhar distribuição junto de assets/fonts e licença OFL. Backup/retencão, IAM/TLS/MFA, carga/custo, viewers nativos e limpeza de arquivos compartilhados continuam responsabilidades da auditoria/integracão antes da publicação. Nenhuma infraestrutura foi configurada.

## Fase F — exposição pública controlada

Sete rotas públicas têm registro OpenAPI com security=[], sem herdar autenticação ou permissões internas. Entradas são strict; visitante não escolhe tenant, preço, nome, unidade, mensagem ou destino. Slug é reservado globalmente por transação e não existe diretório de empresas. Gates no snapshot exigem empresa ativa, assinatura active/past_due, configuração enabled/slug e produto ativo/publicado. Ausente/desativado/suspenso/cancelado recebe indisponibilidade uniforme, sem detalhes privados. Autorização administrativa é relida também em replay.

DTOs excluem tenant, autores, assinatura, cliente, estoque, SKU e financeiro. Categoria não publicada não é mostrada; cursor AES-256-GCM esconde candidato privado e autentica contexto/filtros. Público usa somente IDs opacos necessários de produtos/categorias. Preço oculto é null em detalhe/lista/preview/link; não entra em limite de total, prova de revisão ou erro monetário. Prova HMAC impede usar resumo público alterado para preparar mensagem. Não é credencial de acesso ao sistema interno.

Bucket/Rules continuam privados. Imagem pública passa por caminho interno derivado do produto daquele catálogo e por nova verificação após Storage. Despublicação/suspensão/troca bloqueiam resposta antiga. JSON é coerente no snapshot; dados já obtidos quando públicos não podem ser retirados do dispositivo. no-store evita retenção HTTP deliberada pelo backend. CORS * é restrito ao prefixo público sem credenciais; privado mantém origem autorizada.

Limiter barato em memória precede JSON/Firestore, e contadores compartilham IP/janela, slug/janela e POSTs de orçamento entre instâncias, com buckets separados dos privados. Consultas são paginadas/limitadas, sem total por varredura; orçamento até 200 produtos. Não há orçamento ou dados de contato de visitantes persistidos. rateLimits contém metadados pseudônimos de segurança; expiresAt não elimina registros sem TTL/limpeza futura. Proteção volumétrica/distribuída, custo e retenção precisam de validação antes de publicação, sem infraestrutura nova nesta fase.

Mensagem usa apenas nomes/quantidades/unidades públicos relidos e valores quando autorizados. Controle/bidi/formatação/URLs em nomes são neutralizados. URL tem origem fixa https://wa.me, telefone validado e text codificado, sem destino externo fornecido pelo visitante. Comprimento tem recusa integral; não há envio, sessão pessoal, banco, estoque ou financeiro. Frontend deve renderizar strings como texto, sem HTML/autolink arbitrário.

Teste de falhas após staging verifica rollback de recebimento, cancelamento, físico e resolução. Concorrência verifica guarda por pedido/produto/fonte e idempotência. Hash encadeado detecta divergências cobertas; credencial privilegiada pode reconstruir registros, exigindo IAM mínimo, retenção externa e recuperação consistente antes de produção. Idempotência não tem TTL; remoção exige política aprovada contra replay.

Consultas por página e até doze títulos limitam leituras usuais. Pedidos com muitas fontes de liquidação/restauração acumulam leituras no mesmo commit; tamanho, tempo ou contenção podem recusar a operação inteira. Ainda não há relatório contábil global, fechamento, perda, cobrança automatizada, compensação de físico já concluído ou descarte/reclassificação de danificados. Expansões exigem contratos próprios. SLO/carga de 100 usuários, índices reais, backups produtivos, App Check/Armor/IAM/TLS e custo medido continuam sem comprovação e não foram configurados nesta etapa.
