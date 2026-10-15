# Identidade global e vínculo por empresa

Firebase Authentication identifica a pessoa; o vínculo dentro de cada tenant determina seu perfil e estado. Essa separação permite múltiplas empresas sem duplicar senhas nem confundir cliente comercial com usuário, ao custo de consultas de autorização no servidor. Perfis não dependem de claims desatualizados e a desativação de um vínculo não revoga os demais.
