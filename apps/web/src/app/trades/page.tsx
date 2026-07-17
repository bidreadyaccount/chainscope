'use client';

/** Live Trades page (SPEC §14.D): global streaming feed with pause control. */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { TradeFeed } from '@/components/trade-feed';
import { ErrorState, Skeleton } from '@/components/ui';

export default function TradesPage() {
  const [paused, setPaused] = useState(false);
  const seed = useQuery({ queryKey: ['live-trades'], queryFn: () => api.liveTrades(50) });
  const tokens = useQuery({ queryKey: ['tokens', '24h', ''], queryFn: () => api.tokens('24h') });

  const decimalsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of tokens.data?.items ?? []) map[t.address.toLowerCase()] = t.decimals;
    return map;
  }, [tokens.data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Live Trades</h1>
        <button
          onClick={() => setPaused((p) => !p)}
          className="ml-auto flex items-center gap-1.5 rounded border border-edge px-2.5 py-1 text-xs text-muted hover:text-bright"
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? 'Paused' : 'Live'}
        </button>
      </div>
      {seed.isLoading ? (
        <Skeleton rows={10} />
      ) : seed.isError ? (
        <ErrorState message={(seed.error as Error).message} />
      ) : (
        <div className="rounded-md border border-edge bg-panel p-2">
          <TradeFeed initial={seed.data?.items ?? []} paused={paused} decimalsMap={decimalsMap} />
        </div>
      )}
    </div>
  );
}
