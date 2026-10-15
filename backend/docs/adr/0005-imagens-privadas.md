# Imagens privadas e associação versionada

API administrativa valida raster, limites e MIME e recodifica WebP sem metadados. Não aceita URL externa ou nome/caminho original. Objeto recebe tenant/produto/ID gerado, fica privado, sem download token. Leitura também passa pela autorização empresarial.

Firestore e Storage não compartilham transação. Objeto imutável é salvo antes da associação versionada; falha tenta remover somente objeto da tentativa. Referências anteriores permanecem sem acesso pela API, evitando apagar objeto de uma decisão recente. A contrapartida é retenção/órfãos sem limpeza automática, pendência antes de produção. Catálogo futuro exige área pública separada e aprovação.
