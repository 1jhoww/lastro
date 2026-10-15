# Capacidade e administrador preservados por transação

Usuários ativos e convites pendentes válidos ocupam vagas do plano, independentemente do perfil. Admissão, alteração de vínculo e contadores de administradores são serializados por empresa, com auditoria na transação, para impedir ultrapassagem do limite e remoção simultânea do último administrador. O documento da empresa é um ponto de contenção aceito para gestão de poucos usuários; operações comerciais futuras não deverão usá-lo como contador global de vendas.
