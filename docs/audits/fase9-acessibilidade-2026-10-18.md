# Lastro — Fase 9: acessibilidade e validação pendente

## Escopo

Os testes de navegador desta fase usam Chrome real em Windows com viewport estreito. Uma viewport de 390 px não reproduz teclado nativo, leitor de tela ou comportamento de um telefone físico.

Em 18/10/2026, `adb devices -l` retornou lista vazia. Há definições locais de AVD, mas não havia dispositivo Android conectado. A Fase 8 registrou travamentos de Chrome/ADB no AVD. Nenhum resultado daquela tentativa foi promovido a aprovação.

## Evidência web

O roteiro reproduzível está em `frontend/scripts/audit-phase9-accessibility.cjs`. Usa exclusivamente a cópia local do Auth demo em `127.0.0.1:19099`, API em `:3000` e export web em `localhost:8081`.

Executado com sucesso em 18/10/2026 às 13:00, horário de São Paulo. O resultado está em [accessibility-web.json](evidence/fase9/accessibility-web.json), junto à [imagem do modal](evidence/fase9/name-dialog-390.png). Os resultados devem ser lidos por verificação: formulário renderizado não significa formulário integralmente aprovado.

Cobertura: ordem de Tab no login, erros obrigatórios, nomes de campos, formulários de cliente e pedido, nome inválido no modal de perfil, foco durante o modal, fechamento por Escape e retorno de foco. Não é auditoria WCAG completa.

## Roteiro Android obrigatório antes da publicação

Estado: **pendente de execução real**. Registrar aparelho, versão Android, versão do app, versão do TalkBack e capturas/áudio da sessão.

1. Abrir login; percorrer e-mail, senha, mostrar senha, recuperação e Entrar com TalkBack.
2. Abrir teclado virtual nos campos. Confirmar campo ativo, mensagem de erro e botão principal visíveis, sem rolagem bloqueada.
3. Repetir em recuperação de senha, cadastro/edição de cliente, produto, pedido de 200 itens, recebimento financeiro e perfil.
4. No pedido longo, editar primeira e última linha. Abrir/fechar teclado e confirmar acesso à ação final sem perder valores.
5. Abrir modal de nome e modal financeiro. Confirmar anúncio de título, foco inicial, contenção do foco, ordem dos botões e retorno ao disparador.
6. Usar botão Voltar do Android com teclado aberto e depois com modal aberto. Confirmar que fechamento não envia formulário.
7. Submeter valores inválidos e conferir anúncio das mensagens. Repetir após correção, carregamento e erro de rede.
8. Executar com fonte ampliada, orientação suportada, teclado físico e navegação por foco quando disponível.
9. Conferir permissões de vendedor e mudança de empresa com TalkBack; conteúdo negado não pode permanecer acessível por foco.

Critério de aceite: nenhuma ação essencial inacessível, nenhum foco preso/oculto e nenhum valor perdido durante uso do teclado. Corrigir falhas reproduzidas e repetir o roteiro afetado.

TalkBack e teclado virtual **não estão aprovados**. Esta pendência permanece explícita no parecer de publicação.
