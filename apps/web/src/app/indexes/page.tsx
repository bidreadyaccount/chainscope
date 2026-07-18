'use client';

/** Indexes overview — curated stock-token index baskets with headline stats. */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, type IndexListItem } from '@/lib/api';
import { pct } from '@/lib/format';
import { Badge, ErrorState, FlowText, Hint, Skeleton } from '@/components/ui';

export default function IndexesPage() {
  const q = useQuery({ queryKey: ['indexes'], queryFn: api.indexes });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Indexes</h1>
        <span className="text-xs text-muted">
          Curated tokenized-stock baskets. Analytics only — you hold the underlying stock tokens
          directly; no custody, no index token.
        </span>
      </div>

      {q.isLoading ? (
        <Skeleton rows={8} />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(q.data?.items ?? []).map((idx) => (
            <IndexCard key={idx.slug} idx={idx} />
          ))}
        </div>
      )}
    </div>
  );
}

function IndexCard({ idx }: { idx: IndexListItem }) {
  const level = idx.latestLevel ?? idx.baseValue;
  const sinceInception = idx.latestLevel !== null ? level / idx.baseValue - 1 : null;
  return (
    <Link
      href={`/indexes/${idx.slug}`}
      className="block rounded-md border border-edge bg-panel p-4 transition-colors hover:border-info/50"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{idx.symbol}</div>
          <div className="text-xs text-muted">{idx.name}</div>
        </div>
        <Badge tone="muted" title={`${idx.constituentCount} constituents`}>
          {idx.category ?? 'Index'}
        </Badge>
      </div>
      <div className="mt-3 flex items-baseline gap-2 tabular-nums">
        <span className="text-2xl">
          {level.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
        {sinceInception !== null ? (
          <FlowText value={sinceInception} text={pct(sinceInception)} />
        ) : (
          <span className="text-xs text-muted">level</span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>
          <dt className="text-muted">
            <Hint label="30d" hint="Return over the trailing 30 days" />
          </dt>
          <dd>
            <FlowText value={idx.return30d} text={pct(idx.return30d)} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">
            <Hint label="Vol" hint="Annualized volatility of daily index returns" />
          </dt>
          <dd>{idx.annualizedVolatility !== null ? pct(idx.annualizedVolatility, 0) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Names</dt>
          <dd>{idx.constituentCount}</dd>
        </div>
      </dl>
      <div className="mt-2 text-[11px] text-muted">
        {idx.methodology.replace('_', ' ').toLowerCase()} weighting
        {idx.benchmark ? ` · vs ${idx.benchmark}` : ''}
      </div>
    </Link>
  );
}
