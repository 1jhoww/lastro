# Lastro — plano de homologação remota

Estado em 18/10/2026: **preparado, não executado**. Destino autorizado para inspeção: `lastro-hml`. Alterações remotas, criação de fixtures, e-mails, contas e ensaios ainda exigem autorização própria.

## 1. Pré-condições

1. Aprovar os comandos de índices e aguardar todos os compostos `READY`; verificar as cinco isenções e TTL.
2. Corrigir e conferir as variáveis públicas sem BOM. Fixar origem de frontend permitida no CORS e nos domínios do Auth.
3. Aprovar o IAM mínimo para leitura/atualização de usuários, sem criar credencial JSON.
4. Triar os avisos de dependências; validar uma imagem Linux imutável e o export construído com ambiente correto.
5. Registrar imagem, deployment, contrato, configuração, versão numérica do segredo e responsável pelo teste.
6. Aprovar orçamento, alertas, retenção e procedimento de restauração. Confirmar que o destino não contém dados reais usados pelo teste.
7. Aprovar contas temporárias, caixas de e-mail, empresas sintéticas e limites desta execução. Se qualquer recurso apontar a produção, interromper.

O teste nunca usa o `seed:local`, os fixtures de integração ou ferramentas de limpeza contra Firestore real. Esses programas são de emulador e não constituem um seed remoto autorizado.

## 2. Dados e evidência

Usar rótulo de campanha `HML-AAAAMMDD-<identificador>`, duas empresas A/B, dois administradores empresariais sintéticos e um vendedor. Um Super Admin temporário somente mediante autorização explícita, com responsável e prazo; nenhuma conta administrativa permanente.

Usar caixas de e-mail controladas pelo responsável. Não inventar endereço de pessoa ou cliente real. Criar clientes sem documento quando permitido pelo schema, nomes claramente sintéticos e produtos sem conteúdo comercial real. Registrar IDs em evidência restrita, sem senhas, tokens, códigos de ação ou links de convite.

Preservar os dados após a execução. Uma eventual desativação de contas ou limpeza é outra operação remota e requer autorização; não executar exclusão como teardown automático. Armazenar segredos somente no meio aprovado, fora do Git.

Para cada caso, guardar horário, versão, perfil/empresa pseudonimizados, resultado esperado, status HTTP, código seguro, request ID e estado reconciliado. Hash de contrato/artefato pode ser público; senha, JWT, refresh token, códigos de e-mail e material de hashing nunca entram em evidência.

## 3. Autenticação, autorização e sessão

| Caso                  | Procedimento proposto                                                                               | Critério de aceite                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Login/logout          | Login com conta sintética verificada; navegar; sair; tentar usar cliente anterior                   | Acesso somente autenticado; UI e cache deixam de expor dados após logout                                |
| Recuperação de senha  | Enviar uma mensagem à caixa autorizada; abrir ação; alterar senha; testar código usado/expirado     | Mensagem recebida; ação única; erro seguro; nova senha funciona; não guardar link/código                |
| Convite               | Um convite válido, um replay e um convite recusado por falta de vaga                                | Uso único, vínculo correto, replay sem duplicação, limites preservados                                  |
| Verificação de e-mail | Tentar fluxo protegido antes; verificar pela caixa; atualizar usuário/token                         | Restrição anterior correta; claim atualizado e acesso coerente depois                                   |
| Renovação real        | Manter uma sessão por pelo menos 65 minutos, sem mudar relógio; observar `iat`/`exp` sem salvar JWT | Token novo, mesma identidade e ausência de falha silenciosa; sem afirmar aprovação por token artificial |
| Expiração/revogação   | Em conta sintética autorizada, revogar/bloquear; tentar cliente anterior e renovação                | Servidor recusa token revogado/bloqueado e encerra sessão após nova tentativa permitida                 |
| Conta bloqueada       | Bloqueio administrativo da conta de teste e tentativa de operação                                   | Nenhuma operação ou dado privado após bloqueio; reativação somente autorizada                           |
| Vendedor              | Carteira própria, cliente fora da carteira, financeiro, relatório e usuários                        | Somente permissões atuais; 403 nas rotas negadas; UI não basta como prova                               |
| Isolamento A/B        | Repetir rota com ID da outra empresa e alternar empresa durante leitura                             | Nenhum vazamento, inclusive resposta tardia e cache; 403/404 conforme contrato                          |
| Super Admin           | Com conta temporária aprovada, painel e operações administrativas; usuário comum tenta mesmas rotas | Privilégios restritos; auditoria íntegra; suporte não supera limites indevidos                          |
| Vagas por plano       | No plano oficial, ocupar limite sintético e disputar última vaga com dois convites                  | Nenhum excesso ou alteração de preço/plano; erro esperado e contador correto                            |
| Meu Perfil            | Alterar nome sintético, recarregar e consultar com sessão atual                                     | Persistência no Auth com IAM real; e-mail/credenciais não aparecem no log                               |

Recuperação, verificação, bloqueio, revogação, convite e atualização de perfil alteram recursos; estão **planejados**, não autorizados por uma inspeção de leitura. A espera de sessão é uma janela separada, de aproximadamente 75 minutos, sem polling intenso nem automação recorrente. Combinar quais expirações de códigos podem exigir sessão adicional.

## 4. Funcionalidade e consistência

Após aprovação dos índices, executar listas de auditoria de cobrança, todas as combinações de cobranças, visitas e recompra descritas no [plano de índices](prepublicacao-indices-2026-10-18.md), usando somente fixtures da campanha.

Exercitar cadastro, estoque, pedido, confirmação, replay, expedição, cancelamento, pagamento, relatório CSV/PDF, visita, entrega e recompra. Conferir totais, parcelas, reserva, saldo físico, histórico, autorização e publicação financeira. Comparar o estado por API autorizada e relatórios, sem ajustes diretos de saldo.

Corridas pequenas: duas entradas no mesmo produto; dois recebimentos com mesma versão; dois retries com a mesma chave e corpo. Esperar conflitos de versão previstos e replay sem efeito duplicado. HTTP 409 ou 429 esperado não deve ser convertido em erro funcional nem ignorado sem conferir o código.

Em timeout/503/504 de comando, o resultado pode ser desconhecido. Consultar estado, conservar a mesma chave e corpo e reconciliar antes de repetir. Nunca concluir que a transação foi desfeita só porque a resposta não chegou.

## 5. Performance e custos antes da execução

Os números abaixo são **limites propostos e estimativas de planejamento**, não consumo medido nem garantia de faturamento. O responsável ainda precisa aprovar valor monetário, moeda e janela. Sem esse aceite, não executar.

| Etapa                | Limite proposto                                                                                             | Risco/custo esperado                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Funcional e Auth     | Até 150 chamadas da aplicação, duas empresas, três contas empresariais e um Super Admin temporário opcional | Auth, e-mails e leituras/escritas de autorização, auditoria, idempotência e rate limits |
| Leitura cronometrada | Seis endpoints, dez amostras cada, concorrência máxima 2                                                    | Até 60 chamadas; cada lista pode ler múltiplos documentos e entradas de índice          |
| Pedidos iniciais     | Três pedidos de 1, 20 e 50 linhas, no máximo 50 produtos distintos reutilizados                             | Confirmação, movimentos, títulos, histórico e replays geram mais escritas que linhas    |
| Concorrência         | Uma corrida de estoque e duas financeiras, dois participantes cada                                          | Retries transacionais podem ampliar leituras e latência                                 |
| Relatórios           | Dois CSVs e dois PDFs, até 50 pedidos sintéticos                                                            | Memória, CPU, Storage quando aplicável e tráfego de saída                               |
| Navegador            | Três jornadas frias por perfil desktop/mobile simulado                                                      | Download de JS/fontes, Auth e leituras do Dashboard                                     |
| Sessão longa         | Uma conta sintética, cerca de 75 minutos                                                                    | Refresh Auth e até quatro leituras de confirmação; não polling contínuo                 |

Ensaio de performance: máximo de 300 chamadas instrumentadas da aplicação, janela de até 30 minutos, no máximo 2 requisições simultâneas. A renovação de sessão ocorre fora dessa janela. Pedidos de 100/200 linhas são uma etapa opcional posterior, com novo orçamento e autorização. **Não executar 20 mil fontes/recebimentos, cem usuários ou carga intensa.**

Planejar um envelope conservador inicial de 50.000 leituras e 20.000 escritas de documentos, sujeito à revisão após medir uma jornada pequena. Isso não é teto técnico: retries, fan-out, entradas de índice e contadores podem exceder a estimativa antes da próxima observação. Não começar se esse risco não couber no orçamento aprovado. Interromper o restante do roteiro se a telemetria se aproximar do envelope.

Custo estimado = leituras de documentos/índices × tarifa regional + escritas/exclusões × tarifa + armazenamento de índices/objetos + vCPU/RAM/tempo Cloud Run + tráfego + builds/logs + e-mails/serviços aplicáveis. Consultar as tarifas vigentes de São Paulo e a moeda da conta antes de aprovar; nenhum valor financeiro foi medido ou prometido nesta etapa. [Cobrança Firestore](https://firebase.google.com/docs/firestore/pricing).

Orçamento e alerta de faturamento não são um corte automático de gastos. O operador deve poder interromper o gerador de testes; requests financeiros já aceitos exigem reconciliação e podem continuar. [Documentação de budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets).

### Medição e interrupção

- Registrar tamanho do dataset, filtros, limite, cursor, perfil, N, tempos, status e erros esperados. Medir mediana e intervalo com dez amostras; obter p95 apenas em rodada posterior com N adequado e autorização.
- Medir cold start somente quando logs comprovarem nova instância/revisão. Uma primeira chamada lenta não é prova. Não forçar escala a zero nem alterar min instances nesta etapa.
- Correlacionar logs Cloud Run, memória, CPU, instâncias, retries e operações Firestore; separar rate limits esperados e falhas. Leituras do Admin SDK ignoram Rules e dependem de IAM.
- Registrar carregamento, LCP, login até dados do Dashboard e solicitações duplicadas em cache frio/quente, com a mesma rede simulada da Fase 9. Não comparar emulador e nuvem como experimento causal.
- Interromper imediatamente por vazamento entre empresas, efeito duplicado, saldo divergente, erro de permissão indevido, OOM/restart ou endpoint de produção.
- Interromper novas chamadas se houver dois 5xx inesperados consecutivos, resultado financeiro desconhecido sem reconciliação, três respostas 429 inesperadas em cinco chamadas, duas chamadas acima de 10 segundos ou aumento persistente acima de 30% da baseline remota aprovada.
- Esses limiares são controles propostos do ensaio, não SLO comercial. A baseline remota ainda não existe; aprová-la depois da rodada pequena, sem usar o resultado desejado como aprovação automática.

## 6. Aceite Android e acessibilidade

ADB respondeu em 18/10 com lista vazia. Não havia dispositivo conectado; Docker e export Android não substituem aparelho ou AVD funcional com app instalado. **TalkBack, teclado virtual e app nativo permanecem pendentes.**

Registrar aparelho/AVD, Android, versão do TalkBack, versão e hash do app, tamanho de fonte, teclado e perfil. Usar dados sintéticos e guardar capturas sem senha ou token.

| Jornada             | Verificações reais obrigatórias                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Login e recuperação | Ordem de leitura; e-mail/senha; mostrar senha; teclado; mensagens e envio consciente               |
| Navegação           | Abas, voltar, títulos, foco após trocar tela/empresa; conteúdo negado inacessível por foco         |
| Formulários         | Cliente/produto/pedido/financeiro; rótulos, tipos de teclado, erro anunciado e valores preservados |
| Modais              | Título, foco inicial, contenção, botões, fechamento por Voltar/Escape e retorno ao disparador      |
| Pedidos             | Primeira e última linha, rolagem, seleção/quantidade, totais, confirmação e operação longa         |
| Estoque             | Entrada, ajuste, confirmação, saldo e feedback; ação final visível com teclado aberto              |
| Meu Perfil          | Nome inválido/válido, foco no modal, persistência, logout e recuperação                            |
| Ampliação           | Fonte ampliada, viewport estreita, orientação suportada e teclado físico quando disponível         |

Aceite: nenhuma ação essencial inacessível, foco preso/oculto, leitura de dados proibidos ou perda de valores. Erros anunciados e ação final acessível com teclado. Corrigir falhas reproduzidas e repetir a jornada afetada. O roteiro detalhado da [Fase 9](fase9-acessibilidade-2026-10-18.md) permanece aplicável. Não declarar conformidade WCAG integral apenas por esses casos.

## 7. Saída da homologação

Produzir matriz caso/versão/ambiente/resultado, dataset sintético, métricas, custo observado, falhas e reconciliações, evidência de acessibilidade e aceite do responsável. Toda pendência obrigatória mantém o gate fechado. Aprovar homologação não autoriza commit, push ou produção.
