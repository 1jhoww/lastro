/**
 * Web: redesenha a foto num canvas, no máximo `maxEdge` px no lado maior, e devolve WebP (ou
 * JPEG/PNG quando o navegador não gera WebP). Também converte formatos que o navegador abre mas
 * o servidor não aceita (HEIC no Safari, AVIF, BMP). Null quando o navegador não decodifica.
 */
export async function redrawImage(
  blob: Blob,
  maxEdge: number,
  keepAlpha: boolean,
): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await encode('image/webp');
  if (webp?.type === 'image/webp') return webp;
  return encode(keepAlpha ? 'image/png' : 'image/jpeg');
}
