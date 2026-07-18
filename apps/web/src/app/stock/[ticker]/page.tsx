'use client';

/** Stock-token detail: registry metadata + which indexes hold it. */

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { pct, usd } from '@/lib/format';
import { Badge, Card, ErrorState, Hint, Skeleton } from '@/components/ui';

const bpsToPct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const q = useQuery({ queryKey: ['stock', ticker], queryFn: () => api.stock(ticker) });

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const s = q.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">
          {s.ticker} <span className="text-sm font-normal text-muted">{s.companyName}</span>
        </h1>
        <span className="text-lg tabular-nums">{usd(s.priceUsd)}</span>
        <Badge tone="muted">{s.sector}</Badge>
        {s.isDemo ? (
          <Badge tone="warn" title="Illustrative demo asset — not a real tokenized security">
            Demo asset
          </Badge>
        ) : null}
      </div>
      {s.description ? <p className="max-w-3xl text-sm text-muted">{s.description}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Market cap" value={usd(s.marketCapUsd, { compact: true })} />
        <Stat
          label={
            <Hint
              label="Volatility"
              hint="Annualized volatility estimate used by inverse-vol weighting"
            />
          }
          value={s.volatility !== null ? pct(s.volatility, 0) : '—'}
        />
        <Stat
          label="Dividend yield"
          value={s.dividendYield !== null ? pct(s.dividendYield) : '—'}
        />
        <Stat label="Industry" value={s.industry ?? '—'} />
        <Stat label="Risk rating" value={s.riskRating ?? '—'} />
        <Stat label="Oracle" value={s.oracleStatus} />
        <Stat label="Country / currency" value={`${s.country} / ${s.currency}`} />
        <Stat
          label={<Hint label="Price confidence" hint="Confidence in the current price source" />}
          value={String(s.priceConfidence)}
        />
      </div>

      <Card title="Included in indexes">
        {s.memberOfIndexes.length === 0 ? (
          <p className="text-sm text-muted">Not currently a constituent of any curated index.</p>
        ) : (
          <ul className="divide-y divide-edge/50">
            {s.memberOfIndexes.map((m) => (
              <li key={m.slug} className="flex items-center justify-between py-2">
                <Link href={`/indexes/${m.slug}`} className="hover:text-info">
                  <span className="font-medium">{m.symbol}</span>{' '}
                  <span className="text-xs text-muted">{m.name}</span>
                </Link>
                <span className="text-sm tabular-nums">{bpsToPct(m.weightBps)} weight</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Token & feed">
        <dl className="space-y-2 text-sm">
          <Row label="Contract">
            <span className="font-mono text-xs">
              {s.contractAddress ?? '—'}{' '}
              {s.isDemo ? <span className="text-warn">(demo)</span> : null}
            </span>
          </Row>
          <Row label="Price feed">
            <span className="font-mono text-xs">
              {s.priceFeedAddress ?? '—'}{' '}
              {s.isDemo ? <span className="text-warn">(demo)</span> : null}
            </span>
          </Row>
          <Row label="Decimals">
            <span>{s.decimals}</span>
          </Row>
        </dl>
        <p className="mt-3 border-t border-edge/50 pt-2 text-[11px] text-muted">
          Addresses shown are illustrative demo values. No real Robinhood Chain contract or
          price-feed addresses are used until verified ones are configured.
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-edge bg-panel px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge/50 pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}
