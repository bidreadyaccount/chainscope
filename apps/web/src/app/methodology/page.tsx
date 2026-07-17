'use client';

/**
 * Methodology (SPEC §14.H): renders the API's structured methodology JSON —
 * single source of truth generated from config thresholds, so this page cannot
 * drift from the engines.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pct } from '@/lib/format';
import { Card, ErrorState, Skeleton } from '@/components/ui';

interface Methodology {
  overview: string;
  timeWindows: Array<{ key: string; label: string }>;
  walletClasses: Array<{ class: string; label: string; description: string }>;
  smartMoney: { weights: Record<string, number>; minSampleSize: number };
  tokenMetrics: Array<{ key: string; description: string }>;
  opportunityScore: {
    description: string;
    weights: Record<string, number>;
    signalBands: Array<{ min: number; label: string }> | Record<string, unknown>;
  };
  riskScore: { description: string; penalties: Record<string, number> };
  limitations: string[];
}

const nice = (k: string): string =>
  k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

export default function MethodologyPage() {
  const q = useQuery({
    queryKey: ['methodology'],
    queryFn: api.methodology,
    staleTime: Infinity,
  });

  if (q.isLoading) return <Skeleton rows={10} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const m = q.data as unknown as Methodology;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Methodology</h1>
      <p className="text-sm leading-relaxed text-bright/90">{m.overview}</p>

      <Card title="Wallet labels">
        <dl className="space-y-3 text-sm">
          {m.walletClasses.map((c) => (
            <div key={c.class}>
              <dt className="font-medium">{c.label}</dt>
              <dd className="text-muted">{c.description}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-edge/50 pt-2 text-xs text-muted">
          Labels are model outputs with confidence scores, never accusations. A wallet can hold
          several labels; the primary one is chosen by a documented precedence order.
        </p>
      </Card>

      <Card title="Smart-money scoring">
        <p className="mb-2 text-sm text-muted">
          Weighted composite of historical behaviour; a wallet needs at least{' '}
          {m.smartMoney.minSampleSize} qualifying trades before any status is assigned.
        </p>
        <ul className="grid grid-cols-2 gap-1 text-sm tabular-nums">
          {Object.entries(m.smartMoney.weights).map(([k, w]) => (
            <li key={k} className="flex justify-between border-b border-edge/40 pb-1">
              <span>{nice(k)}</span>
              <span className="text-muted">{pct(w, 0)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Opportunity score">
        <p className="mb-2 text-sm text-muted">{m.opportunityScore.description}</p>
        <ul className="grid grid-cols-2 gap-1 text-sm tabular-nums">
          {Object.entries(m.opportunityScore.weights).map(([k, w]) => (
            <li key={k} className="flex justify-between border-b border-edge/40 pb-1">
              <span>{nice(k)}</span>
              <span className="text-muted">{pct(w, 0)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Risk penalties">
        <p className="mb-2 text-sm text-muted">{m.riskScore.description}</p>
        <ul className="grid grid-cols-2 gap-1 text-sm tabular-nums">
          {Object.entries(m.riskScore.penalties).map(([k, max]) => (
            <li key={k} className="flex justify-between border-b border-edge/40 pb-1">
              <span>{nice(k)}</span>
              <span className="text-muted">up to −{max}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Token metrics">
        <dl className="space-y-2 text-sm">
          {m.tokenMetrics.map((t) => (
            <div key={t.key} className="flex gap-3">
              <dt className="w-52 shrink-0 font-mono text-xs text-info">{t.key}</dt>
              <dd className="text-muted">{t.description}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Known limitations">
        <ul className="space-y-2 text-sm text-bright/90">
          {m.limitations.map((l) => (
            <li key={l}>• {l}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
