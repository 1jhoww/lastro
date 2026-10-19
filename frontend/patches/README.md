# Compatibilidade das dependências corrigidas

`decode-uri-component` 0.5.0 corrige GHSA-vcc3-ghjq-m6fr, mas publica ESM. O consumidor `query-string` 7.1.3, usado pelo Expo Router 57, mantém uma API CommonJS. No Node 24, `require()` desse módulo ESM retorna um namespace; a função está em `.default`.

O patch de uma linha acessa esse export sem alterar parsing, serialização ou tratamento de caracteres. `patch-package --error-on-fail` aplica o patch no `npm ci` e impede aceitar silenciosamente uma versão incompatível. Não substituir `query-string` por uma versão principal diferente: a API consumida pelo Router muda.

`npm run test:dependencies` verifica o consumidor real, acentos, arrays, valores nulos/vazios, cursores, URL, UUID do plugin xcode e credenciais gRPC. A entrada malformada roda em processo filho com limite de dois segundos. Web e Android devem continuar exportando.

Remover o patch e o override somente quando a cadeia oficial do Expo resolver essa compatibilidade, depois de repetir instalação limpa, testes e exports. Os overrides gRPC 1.14.6 e uuid 11.1.1 também devem ser revistos após atualização oficial compatível do SDK.
