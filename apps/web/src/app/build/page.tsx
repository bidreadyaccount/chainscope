'use client';

/**
 * Custom index builder: pick stock tokens, choose a weighting methodology or set
 * manual weights, and preview the resulting basket (weights, sector allocation,
 * concentration) computed live by the index engine. Compute-only — nothing is
 * persisted or traded.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { api, type Methodology, type StockRow } from '@/lib/api';
import { pct, usd } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorState, Hint, Skeleton } from '@/components/ui';

const METHODS: Array<{ key: Methodology | 'MANUAL'; label: string }> = [
  { key: 'MARKET_CAP', label: 'Market cap' },
  { key: 'EQUAL', label: 'Equal' },
  { key: 'PRICE', label: 'Price' },
  { key: 'INVERSE_VOL', label: 'Inverse vol' },
  { key: 'CAP_CAPPED', label: 'Cap-capped' },
  { key: 'MANUAL', label: 'Manual' },
];
const bpsToPct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;

export default function BuildPage() {
  const stocks = useQuery({ queryKey: ['stocks', ''], queryFn: () => api.stocks() });
  const [selected, setSelected] = useState<string[]>([]);
  const [method, setMethod] = useState<Methodology | 'MANUAL'>('MARKET_CAP');
  const [maxWeightPct, setMaxWeightPct] = useState(25);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');

  const toggle = (ticker: string): void => {
    setSelected((prev) =>
      prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker],
    );
    setManual((prev) => ({ ...prev, [ticker]: prev[ticker] ?? 10 }));
  };

  const request = useMemo(() => {
    if (selected.length < 2) return null;
    const base = { tickers: selected, maxWeightBps: Math.round(maxWeightPct * 100) };
    if (method === 'MANUAL') {
      return {
        ...base,
        manualWeights: selected.map((t) => ({ ticker: t, weight: manual[t] ?? 0 })),
      };
    }
    return { ...base, methodology: method };
  }, [selected, method, maxWeightPct, manual]);

  const preview = useQuery({
    queryKey: ['preview', request],
    queryFn: () => api.previewIndex(request!),
    enabled: request !== null,
  });

  const filtered = (stocks.data?.items ?? []).filter(
    (s) =>
      !search ||
      s.ticker.toLowerCase().includes(search.toLowerCase()) ||
      s.companyName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Index Builder</h1>
        <span className="text-xs text-muted">
          Compose a custom basket and preview it live. Nothing is saved or traded — this is a
          design/analysis tool.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`Universe (${selected.length} selected)`}
          right={
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-32 rounded border border-edge bg-bg px-2 py-1 text-xs outline-none focus:border-info"
            />
          }
        >
          {stocks.isLoading ? (
            <Skeleton rows={8} />
          ) : stocks.isError ? (
            <ErrorState message={(stocks.error as Error).message} />
          ) : (stocks.data?.items.length ?? 0) === 0 ? (
            <EmptyState message="No stock tokens available in the registry." />
          ) : filtered.length === 0 ? (
            <EmptyState message={`No stocks match "${search}".`} />
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <tbody>
                  {filtered.map((s) => (
                    <StockPickRow
                      key={s.ticker}
                      s={s}
                      selected={selected.includes(s.ticker)}
                      onToggle={() => toggle(s.ticker)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Methodology">
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  className={`rounded border px-2.5 py-1 text-xs ${
                    method === m.key
                      ? 'border-info bg-info/10 text-bright'
                      : 'border-edge text-muted hover:text-bright'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {(method === 'CAP_CAPPED' || method === 'MARKET_CAP') && (
              <label className="mt-3 flex items-center gap-2 text-xs text-muted">
                Max weight per name: {maxWeightPct}%
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={maxWeightPct}
                  onChange={(e) => setMaxWeightPct(Number(e.target.value))}
                  className="flex-1"
                />
              </label>
            )}
            {method === 'MANUAL' && (
              <div className="mt-3 space-y-1.5">
                {selected.length === 0 ? (
                  <p className="text-xs text-muted">Select names to set manual weights.</p>
                ) : (
                  selected.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-xs">
                      <span className="w-14 font-medium">{t}</span>
                      <input
                        type="number"
                        min={0}
                        value={manual[t] ?? 0}
                        onChange={(e) =>
                          setManual((prev) => ({ ...prev, [t]: Number(e.target.value) }))
                        }
                        className="w-20 rounded border border-edge bg-bg px-2 py-0.5 tabular-nums outline-none focus:border-info"
                      />
                      <span className="text-muted">relative weight</span>
                    </label>
                  ))
                )}
                <p className="pt-1 text-[11px] text-muted">
                  Relative weights are normalized to 100% automatically.
                </p>
              </div>
            )}
          </Card>

          <Card title="Preview">
            {selected.length < 2 ? (
              <p className="text-sm text-muted">Select at least two names to preview a basket.</p>
            ) : preview.isLoading ? (
              <Skeleton rows={5} />
            ) : preview.isError ? (
              <ErrorState message={(preview.error as Error).message} />
            ) : preview.data && !preview.data.ok ? (
              <div className="text-sm text-warn">
                {preview.data.error === 'CAP_INFEASIBLE'
                  ? `Cap too tight: ${maxWeightPct}% × ${selected.length} names can't reach 100%. Raise the cap or add names.`
                  : `Could not build: ${preview.data.error ?? 'invalid input'}.`}
              </div>
            ) : preview.data ? (
              <PreviewBody data={preview.data} />
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StockPickRow({
  s,
  selected,
  onToggle,
}: {
  s: StockRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="border-b border-edge/50">
      <td className="py-1.5">
        <button
          onClick={onToggle}
          className={`flex h-5 w-5 items-center justify-center rounded border ${
            selected ? 'border-info bg-info/20 text-info' : 'border-edge text-transparent'
          }`}
          aria-label={selected ? `Remove ${s.ticker}` : `Add ${s.ticker}`}
        >
          {selected ? <Check size={12} /> : <Plus size={12} className="text-muted" />}
        </button>
      </td>
      <td className="py-1.5 pl-2 font-medium">{s.ticker}</td>
      <td className="py-1.5 pl-2 text-muted">{s.companyName}</td>
      <td className="py-1.5 pl-2 text-right text-muted">{s.sector}</td>
      <td className="py-1.5 pl-2 text-right tabular-nums">{usd(s.marketCapUsd, { compact: true })}</td>
    </tr>
  );
}

function PreviewBody({ data }: { data: import('@/lib/api').IndexPreview }) {
  return (
    <div className="space-y-3">
      {data.excluded.length > 0 || data.unknownTickers.length > 0 ? (
        <p className="text-xs text-warn">
          Excluded: {[...data.excluded.map((e) => `${e.ticker} (${e.reason})`), ...data.unknownTickers].join(', ')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          <Hint label="Effective N" hint="1 / HHI — diversification-equivalent number of names" />:{' '}
          <span className="text-bright">{data.concentration?.effectiveN ?? '—'}</span>
        </span>
        <span>
          Top-5: <span className="text-bright">{data.concentration ? bpsToPct(data.concentration.top5Bps) : '—'}</span>
        </span>
        <span>
          Names: <span className="text-bright">{data.weights.length}</span>
        </span>
      </div>
      <table className="w-full text-[13px] tabular-nums">
        <tbody>
          {data.weights
            .slice()
            .sort((a, b) => b.weightBps - a.weightBps)
            .map((w) => (
              <tr key={w.ticker} className="border-b border-edge/40">
                <td className="py-1 font-medium">{w.ticker}</td>
                <td className="py-1 pl-2">
                  <div className="h-1.5 rounded bg-edge">
                    <div
                      className="h-1.5 rounded"
                      style={{
                        width: `${(w.weightBps / 10000) * 100}%`,
                        background: w.colorTheme ?? '#3b82f6',
                      }}
                    />
                  </div>
                </td>
                <td className="w-16 py-1 pl-2 text-right">{bpsToPct(w.weightBps)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Sectors</h3>
        <div className="flex flex-wrap gap-1.5">
          {data.sectorAllocation.map((s) => (
            <Badge key={s.sector} tone="muted">
              {s.sector} {bpsToPct(s.weightBps)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
