/** Rota ativa: "/" só por igualdade; demais seções também por subrotas. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
