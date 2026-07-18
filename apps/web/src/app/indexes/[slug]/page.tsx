'use client';

/**
 * Index detail: NAV chart, performance, methodology, constituents with weights,
 * sector allocation, and concentration/risk. All figures are computed by the
 * pure index engine and served read-only.
 */

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pct, usd } from '@/lib/format';
import { Badge, Card, ErrorState, FlowText, Hint, Skeleton } from '@/components/ui';
import { IndexNavChart } from '@/components/index-nav-chart';
import { Simulator } from '@/components/simulator';

const bpsToPct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

export default function IndexDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const q = useQuery({ queryKey: ['index', slug], queryFn: () => api.index(slug) });

  if (q.isLoading) return <Skeleton rows={10} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const idx = q.data!;
  const perf = idx.performance;
  const sinceInception = perf.latestLevel !== null ? perf.latestLevel / idx.baseValue - 1 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">
          {idx.symbol} <span className="text-sm font-normal text-muted">{idx.name}</span>
        </h1>
        <span className="text-lg tabular-nums">
          {perf.latestLevel?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}
        </span>
        {sinceInception !== null ? (
          <FlowText value={sinceInception} text={`${pct(sinceInception)} since inception`} />
        ) : null}
        <Badge tone="muted">{idx.methodology.replace('_', ' ').toLowerCase()} weighted</Badge>
        {idx.benchmark ? <Badge tone="info">vs {idx.benchmark}</Badge> : null}
        {idx.isDemo ? (
          <Badge tone="warn" title="Illustrative demo basket — not investment advice">
            Demo
          </Badge>
        ) : null}
      </div>
      {idx.description ? <p className="max-w-3xl text-sm text-muted">{idx.description}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Index level (base 1000 at inception)">
            <IndexNavChart history={idx.navHistory} baseValue={idx.baseValue} />
          </Card>
        </div>
        <Card title="Performance & risk">
          <dl className="space-y-2 text-sm tabular-nums">
            {(
              [
                ['1 day', perf.returns['1d']],
                ['7 day', perf.returns['7d']],
                ['30 day', perf.returns['30d']],
                ['90 day', perf.returns['90d']],
                ['YTD', perf.returns['ytd']],
              ] as const
            ).map(([label, v]) => (
              <Row key={label} label={label}>
                <FlowText value={v ?? null} text={pct(v ?? null)} />
              </Row>
            ))}
            <Row
              label={
                <Hint label="Volatility" hint="Annualized volatility of daily index returns" />
              }
            >
              <span>
                {perf.annualizedVolatility !== null ? pct(perf.annualizedVolatility) : '—'}
              </span>
            </Row>
            <Row
              label={
                <Hint label="Max drawdown" hint="Worst peak-to-trough decline in the series" />
              }
            >
              <span className="text-neg">
                {perf.maxDrawdown !== null ? pct(perf.maxDrawdown) : '—'}
              </span>
            </Row>
            <Row
              label={
                <Hint
                  label="Effective N"
                  hint="1 / HHI — the diversification-equivalent number of equal positions"
                />
              }
            >
              <span>{idx.concentration.effectiveN}</span>
            </Row>
            <Row
              label={
                <Hint label="Top-5 weight" hint="Combined weight of the five largest holdings" />
              }
            >
              <span>{bpsToPct(idx.concentration.top5Bps)}</span>
            </Row>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`Constituents (${idx.constituents.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px] tabular-nums">
                <thead>
                  <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-2 py-1.5 font-medium">Ticker</th>
                    <th className="px-2 py-1.5 font-medium">Company</th>
                    <th className="px-2 py-1.5 text-right font-medium">Weight</th>
                    <th className="px-2 py-1.5 text-right font-medium">Price</th>
                    <th className="px-2 py-1.5 text-right font-medium">Mkt cap</th>
                    <th className="px-2 py-1.5 text-right font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {idx.constituents.map((c) => (
                    <tr key={c.ticker} className="border-b border-edge/50">
                      <td className="px-2 py-1.5">
                        <Link href={`/stock/${c.ticker}`} className="font-medium hover:text-info">
                          {c.ticker}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-muted">{c.companyName}</td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-1.5 rounded"
                            style={{
                              width: `${Math.max(6, (c.weightBps / 10000) * 60)}px`,
                              background: c.colorTheme ?? '#3b82f6',
                            }}
                          />
                          {bpsToPct(c.weightBps)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">{usd(c.priceUsd)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {usd(c.marketCapUsd, { compact: true })}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RiskBadge risk={c.riskRating} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Sector allocation">
          <ul className="space-y-2 text-sm tabular-nums">
            {idx.sectorAllocation.map((s) => (
              <li key={s.sector}>
                <div className="flex items-center justify-between">
                  <span className="text-muted">{s.sector}</span>
                  <span>{bpsToPct(s.weightBps)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-edge">
                  <div
                    className="h-1.5 rounded bg-info"
                    style={{ width: `${(s.weightBps / 10000) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-edge/50 pt-2 text-[11px] text-muted">
            Rebalance: {idx.rebalanceSchedule.toLowerCase()} · cap {bpsToPct(idx.maxWeightBps)} per
            name
          </p>
        </Card>
      </div>

      <Simulator slug={idx.slug} />
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-edge/50 pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return <span className="text-muted">—</span>;
  const tone = risk === 'LOW' ? 'pos' : risk === 'HIGH' ? 'neg' : 'warn';
  return <Badge tone={tone}>{risk.toLowerCase()}</Badge>;
}
