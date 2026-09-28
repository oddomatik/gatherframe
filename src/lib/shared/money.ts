export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}
export function dollarsToCents(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) throw new Error('invalid amount');
  return Math.round(n * 100);
}
