/** Nativo: sem canvas; o seletor já comprime (quality) e o servidor reduz para o tamanho final. */
export async function redrawImage(
  _blob: Blob,
  _maxEdge: number,
  _keepAlpha: boolean,
): Promise<Blob | null> {
  return null;
}
