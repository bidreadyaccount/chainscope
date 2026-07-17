'use client';

/**
 * Minimal shadcn-style primitives (deviation documented in the handoff: the
 * few needed primitives are hand-rolled instead of installing the shadcn CLI —
 * same aesthetic, fraction of the surface).
 */

import { type ReactNode } from 'react';

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-md border border-edge bg-panel">
      {title ? (
        <header className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {right}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({
  tone,
  children,
  title,
}: {
  tone: 'pos' | 'neg' | 'warn' | 'info' | 'muted';
  children: ReactNode;
  title?: string;
}) {
  const tones: Record<string, string> = {
    pos: 'bg-pos/10 text-pos border-pos/30',
    neg: 'bg-neg/10 text-neg border-neg/30',
    warn: 'bg-warn/10 text-warn border-warn/30',
    info: 'bg-info/10 text-info border-info/30',
    muted: 'bg-edge/50 text-muted border-edge',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Opportunity-score badge — signal-banded colors (amber reserved for caution). */
export function ScoreBadge({ score, signal }: { score: number; signal?: string }) {
  const tone = score >= 65 ? 'pos' : score >= 50 ? 'info' : score >= 35 ? 'warn' : 'neg';
  return (
    <Badge tone={tone} title={signal}>
      {Math.round(score)}
    </Badge>
  );
}

const CLASS_LABELS: Record<string, { label: string; tone: 'pos' | 'neg' | 'warn' | 'info' | 'muted' }> = {
  MEGA_WHALE: { label: 'Mega whale', tone: 'info' },
  WHALE: { label: 'Whale', tone: 'info' },
  LARGE_TRADER: { label: 'Large trader', tone: 'info' },
  SMART_MONEY: { label: 'Smart money', tone: 'pos' },
  RETAIL: { label: 'Retail', tone: 'muted' },
  NEW_WALLET: { label: 'New wallet', tone: 'warn' },
  BOT: { label: 'Possible bot', tone: 'warn' },
  DEPLOYER_LINKED: { label: 'Deployer-linked', tone: 'warn' },
  MARKET_MAKER: { label: 'Market maker', tone: 'muted' },
  PROTOCOL: { label: 'Protocol', tone: 'muted' },
  UNKNOWN: { label: 'Unknown', tone: 'muted' },
};

export function ClassChip({ walletClass }: { walletClass: string }) {
  const c = CLASS_LABELS[walletClass] ?? CLASS_LABELS['UNKNOWN']!;
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

/** Net-flow cell: green strictly positive, red strictly negative, neutral zero. */
export function FlowText({ value, text }: { value: number | null | undefined; text: string }) {
  const cls =
    value === null || value === undefined || value === 0
      ? 'text-muted'
      : value > 0
        ? 'text-pos'
        : 'text-neg';
  return <span className={`tabular-nums ${cls}`}>{text}</span>;
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 rounded bg-edge/60" />
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-muted">{message}</p>;
}

export function ErrorState({ message }: { message: string }) {
  return (
    <p className="py-8 text-center text-sm text-warn">
      {message}
      <span className="mt-1 block text-xs text-muted">
        Is the API running? Check the Status page.
      </span>
    </p>
  );
}

/** Tooltip via title attr + dotted underline (restrained, accessible). */
export function Hint({ label, hint }: { label: ReactNode; hint: string }) {
  return (
    <span title={hint} className="cursor-help underline decoration-dotted decoration-muted/60 underline-offset-2">
      {label}
    </span>
  );
}
