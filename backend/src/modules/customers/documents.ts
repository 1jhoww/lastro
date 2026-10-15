// Mathematical validation only: this is not a check of registration at Receita Federal.
export function normalizeDocument(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[.\-/\s]/g, '');
}
export function validDocument(input: string): boolean {
  const value = normalizeDocument(input);
  if (/^(.)\1+$/.test(value)) return false;
  if (/^\d{11}$/.test(value)) {
    const digits = [...value].map(Number);
    const check = (length: number) => {
      const remainder =
        (digits.slice(0, length).reduce((sum, n, i) => sum + n * (length + 1 - i), 0) * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return check(9) === digits[9] && check(10) === digits[10];
  }
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value)) return false;
  const check = (base: string) => {
    const sum = [...base]
      .reverse()
      .reduce((total, c, i) => total + (c.charCodeAt(0) - 48) * (2 + (i % 8)), 0);
    const remainder = sum % 11;
    return remainder < 2 ? '0' : String(11 - remainder);
  };
  const first = check(value.slice(0, 12));
  return value.slice(12) === first + check(value.slice(0, 12) + first);
}
