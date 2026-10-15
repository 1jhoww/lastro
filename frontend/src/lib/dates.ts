/** "08/10/2026" a partir de um instante ISO, no fuso do aparelho. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** "08/10/2026 14:05" a partir de um instante ISO, no fuso do aparelho. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mi}`;
}
