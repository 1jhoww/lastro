/** Arquivos privados nunca sobrevivem à identidade ou empresa que autorizou a leitura. */
let revision = 0;
const cleaners = new Set<() => void>();
export function resetPrivateFiles() {
  revision++;
  cleaners.forEach((clean) => {
    try {
      clean();
      cleaners.delete(clean);
    } catch {
      /* Preserva limpeza para a próxima troca; a revisão já bloqueou o uso. */
    }
  });
}
export function fileLease() {
  const captured = revision;
  return () => {
    if (captured !== revision)
      throw new Error('Sessão ou empresa mudou. Solicite o arquivo novamente.');
  };
}
export function trackPrivateFile(clean: () => void) {
  cleaners.add(clean);
  return () => {
    try {
      clean();
      cleaners.delete(clean);
    } catch {
      /* Repetir a limpeza na próxima troca. */
    }
  };
}
