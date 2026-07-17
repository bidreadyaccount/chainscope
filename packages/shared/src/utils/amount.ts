/**
 * Decimal-aware conversion between human token amounts (JS number, display only)
 * and raw integer onchain quantities (string, storage/wire). Raw amounts are
 * never stored as floats (SPEC §6).
 */

/** Convert a human amount to a raw integer string given the token's decimals. */
export function toRawAmount(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human < 0) return '0';
  const d = Math.max(0, Math.min(36, Math.floor(decimals)));
  const fixed = human.toFixed(Math.min(d, 100));
  const [intPart = '0', fracPartRaw = ''] = fixed.split('.');
  const fracPart = (fracPartRaw + '0'.repeat(d)).slice(0, d);
  const combined = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

/** Convert a raw integer string back to an approximate human number (display). */
export function fromRawAmount(raw: string, decimals: number): number {
  const d = Math.max(0, Math.floor(decimals));
  if (!/^\d+$/.test(raw)) return 0;
  if (d === 0) return Number(raw);
  const padded = raw.padStart(d + 1, '0');
  const intPart = padded.slice(0, padded.length - d);
  const fracPart = padded.slice(padded.length - d);
  return Number(`${intPart}.${fracPart}`);
}
