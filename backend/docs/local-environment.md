# Ambiente local persistente

Desenvolvimento local com Firebase Emulators (Auth, Firestore e Storage) no projeto `demo-lastro-phase-a`. Nenhum projeto Firebase real é usado. Os dados sobrevivem a reinícios do computador, e o seed oferece contas de teste fixas e uma distribuidora de demonstração completa.

## Rotina diária

Pasta `backend`. Se o Node global não for o exigido, troque `npm` por `powershell -ExecutionPolicy Bypass -File scripts/npm.ps1`.

```powershell
npm run emulators        # terminal 1: restaura os dados salvos
npm run dev              # terminal 2: API em http://127.0.0.1:3000
cd ..\frontend; npm run web   # terminal 3: http://localhost:8081
```

Para encerrar: **Ctrl+C uma única vez** no terminal dos emuladores e aguarde a mensagem `Dados salvos em ...`, ou rode `npm run emulators:stop` em outro terminal. Um segundo Ctrl+C força a saída sem exportar.

`npm run local:check` lista o que está pronto e o que falta (Node, Java, `.env`, senhas configuradas, dados salvos, emuladores, contas, empresa demo, API e frontend). Nunca mostra senhas.

## Primeira configuração

1. `Copy-Item .env.example .env` (se ainda não existir).
2. Defina no `backend/.env` uma senha própria, com 12 ou mais caracteres, para cada conta demo:

   ```
   LASTRO_DEMO_PLATFORM_PASSWORD=...
   LASTRO_DEMO_ADMIN_PASSWORD=...
   LASTRO_DEMO_SELLER_PASSWORD=...
   ```

   O `.env` é ignorado pelo Git. Sem essas variáveis, o seed para com instruções e não cria nada.

3. Com os emuladores ligados: `npm run seed:local`.

## Persistência

- `npm run emulators` inicia com `--import .local/emulator-data` (quando existe uma exportação) e `--export-on-exit .local/emulator-data`. Na primeira execução, sem exportação, começa vazio.
- Enquanto roda, o launcher grava um snapshot a cada 5 minutos (`EMULATOR_AUTOSAVE_MINUTES` no `.env`; `0` desativa). Isso limita a perda a poucos minutos se a janela for fechada, o processo for morto ou o computador desligar com os emuladores abertos — nesses casos o `--export-on-exit` não tem tempo de rodar.
- A cada início, a exportação atual é copiada para `.local/emulator-backups/<data>-inicio`. Só as 10 cópias automáticas mais recentes são mantidas; backups manuais nunca são removidos.
- Nada é apagado na inicialização. Se `.local/emulator-data` existir sem exportação válida, o launcher recusa iniciar em vez de sobrescrever.
- A exportação do Firebase troca o diretório inteiro: grava numa pasta temporária `backend/firebase-export-*` e depois substitui. Se uma pasta dessas sobrar após uma queda, ela contém a última exportação incompleta ou completa; não é versionada.
- A suíte de integração (`npm run test:integration`) usa outro projeto (`demo-lastro-tests`) e não usa nem altera esses dados. Ela exige as mesmas portas: encerre os emuladores de desenvolvimento antes.

Tudo fica em `backend/.local/`, ignorado pelo Git, Docker e Cloud Build.

## Backup e restauração

```powershell
npm run emulators:export              # salva agora e copia para .local/emulator-backups/<data>-manual
npm run emulators:export -- antes-teste   # mesmo, com rótulo
npm run emulators:restore             # lista os backups
npm run emulators:stop
npm run emulators:restore -- 20261016-213000-manual-antes-teste
npm run emulators
```

A restauração exige os emuladores parados. Os dados atuais não são apagados: viram o backup `<data>-antes-restauracao`.

## Contas de teste

| Conta | Perfil | Acesso |
| --- | --- | --- |
| `platform.demo@lastro.invalid` | Super Admin | Painel da plataforma (sem vínculo com empresas) |
| `admin.demo@lastro.invalid` | Administrador da Distribuidora Demo Lastro | Todos os módulos operacionais do plano Profissional |
| `vendedor.demo@lastro.invalid` | Vendedor da Distribuidora Demo Lastro | Carteira própria de clientes, pedidos próprios, estoque disponível |

As contas são criadas direto no Auth Emulator com e-mail verificado. Os vínculos e perfis passam pelo fluxo real de convite e aceite. Senhas existentes nunca são trocadas pelo seed; se você mudar uma senha no `.env`, aplique-a no emulador com `npm run seed:local -- --sync-passwords`.

Painel da plataforma exige login recente (5 minutos) para ações administrativas, como em produção.

## Dados de demonstração

**Distribuidora Demo Lastro** (plano Profissional, 2 usuários), com histórico de 90 dias:

- 3 categorias, 11 produtos (UN, CX, PCT, KG) com preço e estoque mínimo; 4 formas de pagamento; 4 condições (à vista, 30, 30/60, 30/60/90 dias).
- 9 clientes fictícios com CNPJ/CPF matematicamente válidos; 3 na carteira do vendedor.
- Estoque: 11 entradas iniciais, 2 reposições, 2 ajustes de perda; 2 produtos abaixo do mínimo.
- 12 pedidos: quitados (D01, D05, D08), expedidos com saldo vencido (D02 parcial, D04 integral), parcelados com parcela paga, parcela vencendo hoje e futura (D03, com desconto), pagamento parcial antes do vencimento (D07), confirmados aguardando entrega (D09, D10), cancelado (D06) e rascunhos (D11 com desconto, D12).
- Pedidos confirmados e expedidos geram PDF comercial e romaneio.

Os registros demo são identificados por marcas visíveis: `[demo:D01]` nas observações do pedido, `[demo:E01]` nas observações de movimentos e `demo:D01-R1` na referência do recebimento.

O histórico é gravado pela API real, com o relógio da aplicação deslocado para as datas passadas (mesma técnica dos testes de integração). Assim os vencimentos são válidos no momento da venda e hoje aparecem como vencidos, sem estados impossíveis. A data-base fica fixa (criação da empresa + 90 dias): com o passar dos dias, títulos a vencer viram vencidos naturalmente.

## Seed idempotente

`npm run seed:local` pode ser executado quantas vezes quiser. Cada item é procurado antes de ser criado: contas por e-mail, empresa pelo nome, clientes por CPF/CNPJ, produtos por SKU, categorias, formas e condições pelo nome, pedidos, movimentos e recebimentos pelas marcas acima. O que existe é preservado; só o que falta é criado. Nada é alterado nem removido. Se um passo não puder ser aplicado (por exemplo, estoque consumido por pedidos manuais), ele é relatado como aviso e os demais seguem.

Proteções: o seed só roda com `FIREBASE_MODE=emulator`, projeto `demo-lastro-phase-a`, hosts de emulador em `localhost`, Auth e Firestore Emulator respondendo e emuladores iniciados por `npm run emulators` (os dados precisam ser persistidos). Credenciais de nuvem (`GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN`) são descartadas. Senhas não são impressas.

## Login pelo frontend

`frontend/.env` (cópia de `.env.example`) já aponta para o Auth Emulator e a API local. Entre em `http://localhost:8081` com uma das contas acima.
