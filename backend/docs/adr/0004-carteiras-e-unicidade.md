# Carteira por propriedade e unicidade transacional

Cliente comercial é distinto de identidade/tenant. Responsável é vendedor ativo da mesma empresa, validado pelo backend. Transferência administrativa exige versão do cliente e audita responsável anterior/novo; vendedor acessa somente sua carteira.

CPF/CNPJ normalizado e SKU têm reservas por hash no tenant. Transação lê recurso, reserva e autorização antes de escrever recurso/auditoria. Isso protege corridas sem varredura e permite mesma chave em outra empresa. Inativos mantêm reserva; edição libera chave antiga atomicamente. Cliente sem documento não tem promessa de idempotência.

Busca por prefixo e paginação indexada foram escolhidas em vez de texto completo/offset. Filtros flexíveis têm custo de índices; medir antes de ampliar ou retirar combinações.
