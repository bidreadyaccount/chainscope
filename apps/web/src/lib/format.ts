/** Display formatting only — raw onchain amounts stay strings for math. */

export function usd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (opts.compact && abs >= 1_000_000_000)
    return `$${(v / 1_000_000_000).toFixed(2).replace(/\.00$/, '')}B`;
  if (opts.compact && abs >= 1_000_000)
    return `$${(v / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (opts.compact && abs >= 10_000) return `$${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (abs > 0 && abs < 0.01) return `$${v.toPrecision(2)}`;
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: abs < 10 ? 4 : 2,
  });
}

/** Signed net-flow with explicit +/-. */
export function flow(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v === 0) return '$0';
  return `${v > 0 ? '+' : '−'}${usd(Math.abs(v), { compact: true })}`;
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US');
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function timeAgo(iso: string | number | Date): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Format a raw bigint token amount for display using its decimals. */
export function rawAmount(raw: string, decimals: number, maxDp = 4): string {
  try {
    const v = BigInt(raw);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = v % base;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, maxDp).replace(/0+$/, '');
    const wholeStr = whole.toLocaleString('en-US');
    return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
  } catch {
    return raw;
  }
}

export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const txUrl = (hash: string): string => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string): string => `${EXPLORER}/address/${addr}`;
