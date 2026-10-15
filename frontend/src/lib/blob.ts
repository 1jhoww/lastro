/** Leitura de Blob compatível com web e React Native, sem URL permanente de armazenamento. */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler a imagem'));
    reader.readAsDataURL(blob);
  });
}
