'use client';

/**
 * Market Overview — the default route (SPEC §14.A, core-MVP columns per
 * BUILD_BRIEF). One token per row; window selector; search; column sorting;
 * live updates over WS with a pause control.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Search } from 'lucide-react';
import { api, WINDOWS, type TokenRow, type Window } from '@/lib/api';
import { useLiveFeed } from '@/lib/ws';
import { flow, num, usd } from '@/lib/format';
import { ErrorState, FlowText, Hint, ScoreBadge, Skeleton, Badge } from '@/components/ui';

type SortKey =
  | 'rank'
  | 'priceUsd'
  | 'liquidityUsd'
  | 'buyVolumeUsd'
  | 'sellVolumeUsd'
  | 'uniqueBuyers'
  | 'whaleNetFlowUsd'
  | 'smartMoneyNetFlowUsd'
  | 'retailNetFlowUsd'
  | 'opportunityScore'
  | 'riskScore'
  | 'dataConfidence';

const COLUMNS: Array<{ key: SortKey | null; label: string; hint?: string; align?: 'right' }> = [
  { key: 'rank', label: '#' },
  { key: null, label: 'Token' },
  { key: 'priceUsd', label: 'Price', align: 'right' },
  { key: 'liquidityUsd', label: 'Liquidity', align: 'right', hint: 'Pool liquidity in USD' },
  { key: 'buyVolumeUsd', label: 'Buys', align: 'right', hint: 'Buy volume in the selected window' },
  { key: 'sellVolumeUsd', label: 'Sells', align: 'right', hint: 'Sell volume in the selected window' },
  { key: 'uniqueBuyers', label: 'Buyers', align: 'right', hint: 'Unique buying wallets' },
  { key: 'whaleNetFlowUsd', label: 'Whale flow', align: 'right', hint: 'Whale net flow (buys − sells). Green = net buying.' },
  { key: 'smartMoneyNetFlowUsd', label: 'Smart $', align: 'right', hint: 'Net flow from wallets with strong historical performance' },
  { key: 'retailNetFlowUsd', label: 'Retail', align: 'right', hint: 'Retail-wallet net flow' },
  { key: 'opportunityScore', label: 'Score', align: 'right', hint: 'Explainable 0–100 Opportunity Score. Click a token for the full breakdown.' },
  { key: 'riskScore', label: 'Risk', align: 'right', hint: 'Separate 0–100 risk score from penalty factors' },
  { key: 'dataConfidence', label: 'Conf', align: 'right', hint: 'Data-confidence: price-source quality and sample size' },
];

export default function MarketPage() {
  const [window_, setWindow] = useState<Window>('1h');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rank', desc: false });
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['tokens', window_, search],
    queryFn: () => api.tokens(window_, search || undefined),
    refetchInterval: paused ? false : 15_000,
  });

  // Score frames arrive continuously; refresh the table (throttled by staleTime).
  const wsState = useLiveFeed({
    channels: ['score'],
    paused,
    onFrame: () => void qc.invalidateQueries({ queryKey: ['tokens', window_] }),
  });

  const rows = useMemo(() => {
    const items = query.data?.items ?? [];
    const dir = sort.desc ? -1 : 1;
    return [...items].sort((a, b) => {
      const av = a[sort.key] ?? -Infinity;
      const bv = b[sort.key] ?? -Infinity;
      return av === bv ? 0 : av > bv ? dir : -dir;
    });
  }, [query.data, sort]);

  const toggleSort = (key: SortKey | null): void => {
    if (!key) return;
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'rank' }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Market Overview</h1>
        <div className="flex rounded border border-edge">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-2.5 py-1 text-xs ${w === window_ ? 'bg-edge text-bright' : 'text-muted hover:text-bright'}`}
            >
              {w}
            </button>
          ))}
        </div>
        <label className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search token…"
            className="w-44 rounded border border-edge bg-panel py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted focus:border-info"
          />
        </label>
        <button
          onClick={() => setPaused((p) => !p)}
          className="ml-auto flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:text-bright"
          title={paused ? 'Resume live updates' : 'Pause live updates'}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Paused' : wsState === 'open' ? 'Live' : 'Connecting…'}
          {!paused && wsState === 'open' ? (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pos" aria-hidden />
          ) : null}
        </button>
      </div>

      {query.isLoading ? (
        <Skeleton rows={12} />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full min-w-[1100px] text-[13px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''} ${c.key ? 'cursor-pointer select-none hover:text-bright' : ''}`}
                  >
                    {c.hint ? <Hint label={c.label} hint={c.hint} /> : c.label}
                    {c.key === sort.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <Row key={t.address} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Window: {window_} · {rows.length} tokens · scores update live. Signal bands: 80+ Strong
        accumulation · 65+ Positive · 50+ Mixed · 35+ Elevated selling · below 35 Strong
        distribution.
      </p>
    </div>
  );
}

function Row({ t }: { t: TokenRow }) {
  return (
    <tr className="border-b border-edge/60 tabular-nums transition-colors hover:bg-edge/30">
      <td className="px-3 py-2 text-muted">{t.rank ?? '—'}</td>
      <td className="px-3 py-2">
        <Link href={`/token/${t.address}`} className="font-medium hover:text-info">
          {t.symbol}
        </Link>
        <span className="ml-2 hidden text-xs text-muted lg:inline">{t.name}</span>
      </td>
      <td className="px-3 py-2 text-right">
        {t.priceUsd === null ? (
          <Badge tone="warn" title="No confident price source — never fabricated">
            Insufficient pricing data
          </Badge>
        ) : (
          usd(t.priceUsd)
        )}
      </td>
      <td className="px-3 py-2 text-right">{usd(t.liquidityUsd, { compact: true })}</td>
      <td className="px-3 py-2 text-right text-pos">{usd(t.buyVolumeUsd, { compact: true })}</td>
      <td className="px-3 py-2 text-right text-neg">{usd(t.sellVolumeUsd, { compact: true })}</td>
      <td className="px-3 py-2 text-right">
        {num(t.uniqueBuyers)}
        <span className="text-muted">/{num(t.uniqueSellers)}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <FlowText value={t.whaleNetFlowUsd} text={flow(t.whaleNetFlowUsd)} />
      </td>
      <td className="px-3 py-2 text-right">
        <FlowText value={t.smartMoneyNetFlowUsd} text={flow(t.smartMoneyNetFlowUsd)} />
      </td>
      <td className="px-3 py-2 text-right">
        <FlowText value={t.retailNetFlowUsd} text={flow(t.retailNetFlowUsd)} />
      </td>
      <td className="px-3 py-2 text-right">
        <ScoreBadge score={t.opportunityScore} signal={t.signal} />
      </td>
      <td className="px-3 py-2 text-right">{Math.round(t.riskScore)}</td>
      <td className="px-3 py-2 text-right">
        <span className={t.dataConfidence < 40 ? 'text-warn' : 'text-muted'}>
          {Math.round(t.dataConfidence)}
        </span>
      </td>
    </tr>
  );
}
