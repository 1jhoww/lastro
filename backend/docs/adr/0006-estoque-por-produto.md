# Estoque serializado por produto e projeção de reposição

Um agregado por tenant/produto guarda físico/reservado em escala 1000. Disponível é derivado. Escritas atômicas criam movimento imutável, atualizam agregado, persistem operação idempotente e auditam. Ajustes por variação exigem versão; entradas acumulam sem sobrescrever saldos. Chave de operação escopada ao tenant impede replay por outro comando/ator; sem expiração automática.

Produto armazena mínimo textual compatível com legado zero. Alterar metadados/mínimo sincroniza projeção de estoque/reposição; movimento também atualiza belowMinimum/shortfall. Isso evita varredura para achar produtos abaixo do mínimo e acrescenta custo de índices. Unidade trava após primeira movimentação para preservar o significado do histórico.

Reconciliação paginada verifica sequência, hash encadeado e aritmética e compara saldo/cabeça final. Cursor vincula progresso à versão observada; mudança exige reinício. Não há reparo automático nem proteção contra reconstrução integral por credencial privilegiada. Contenção fica local ao produto; testar capacidade real antes de sharding/infraestrutura adicional.
