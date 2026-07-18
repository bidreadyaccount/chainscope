'use client';

/**
 * Portfolio simulator panel for an index: enter an amount, see the per-
 * constituent allocation (USD + fractional shares) and how that investment would
 * have tracked the index's own NAV history. Read-only — no order is placed.
 * Benchmark comparison is shown only when a benchmark series is actually
 * available (never fabricated).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pct, usd } from '@/lib/format';
import { Card, ErrorState, FlowText, Skeleton } from './ui';

const PRESETS = [100, 500, 1000, 5000];
const bpsToPct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

export function Simulator({ slug }: { slug: string }) {
  const [amount, setAmount] = useState(1000);
  const sim = useQuery({
    queryKey: ['simulate', slug, amount],
    queryFn: () => api.simulate(slug, amount),
    enabled: amount > 0,
  });

  return (
    <Card title="Portfolio simulator">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-edge">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setAmount(p)}
              className={`px-2.5 py-1 text-xs tabular-nums ${
                amount === p ? 'bg-edge text-bright' : 'text-muted hover:text-bright'
              }`}
            >
              ${p.toLocaleString('en-US')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xs text-muted">
          $
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            className="w-28 rounded border border-edge bg-bg px-2 py-1 tabular-nums outline-none focus:border-info"
          />
        </label>
      </div>

      {sim.isLoading ? (
        <Skeleton rows={5} />
      ) : sim.isError ? (
        <ErrorState message={(sim.error as Error).message} />
      ) : sim.data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 text-sm tabular-nums">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">
                Value over the series
              </div>
              {sim.data.projectionAvailable ? (
                <div className="text-lg">
                  {usd(sim.data.finalValueUsd)}{' '}
                  {sim.data.totalReturn !== null ? (
                    <FlowText
                      value={sim.data.totalReturn}
                      text={`(${pct(sim.data.totalReturn)})`}
                    />
                  ) : null}
                </div>
              ) : (
                <div
                  className="text-sm text-warn"
                  title={sim.data.projectionUnavailableReason ?? ''}
                >
                  Not shown — a holding has no usable price, so the basket differs from the index.
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted">Invested</div>
              <div className="text-lg">{bpsToPct(sim.data.investedWeightBps)}</div>
            </div>
          </div>

          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="py-1 font-medium">Ticker</th>
                <th className="py-1 text-right font-medium">Weight</th>
                <th className="py-1 text-right font-medium">Allocation</th>
                <th className="py-1 text-right font-medium">Shares</th>
              </tr>
            </thead>
            <tbody>
              {sim.data.allocations.map((a) => (
                <tr key={a.ticker} className="border-b border-edge/40">
                  <td className="py-1 font-medium">{a.ticker}</td>
                  <td className="py-1 text-right text-muted">{bpsToPct(a.weightBps)}</td>
                  <td className="py-1 text-right">{usd(a.allocationUsd)}</td>
                  <td className="py-1 text-right text-muted">
                    {a.shares.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sim.data.excluded.length > 0 ? (
            <p className="text-xs text-warn">
              Excluded (no usable price): {sim.data.excluded.map((e) => e.ticker).join(', ')}
            </p>
          ) : null}

          <p className="border-t border-edge/50 pt-2 text-[11px] text-muted">
            Projection tracks the index&apos;s own historical level.{' '}
            {sim.data.benchmarkComparisonAvailable
              ? `Compared against ${sim.data.benchmark}.`
              : `Benchmark comparison${sim.data.benchmark ? ` vs ${sim.data.benchmark}` : ''} is not available — no benchmark price series is ingested yet, so none is shown rather than fabricated.`}{' '}
            Illustrative only; not investment advice.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
