'use client';

/**
 * Shared live trade feed (SPEC §14.D): seeded from REST, appended over WS,
 * restrained highlight on new rows, pause control handled by the parent.
 */

import Link from 'next/link';
import { useState } from 'react';
import { type Trade } from '@/lib/api';
import { useLiveFeed } from '@/lib/ws';
import { rawAmount, shortAddr, timeAgo, txUrl, usd } from '@/lib/format';
import { Badge, ClassChip, EmptyState } from './ui';

export function TradeFeed({
  initial,
  tokenFilter,
  paused,
  max = 60,
  decimalsMap,
}: {
  initial: Trade[];
  tokenFilter?: string;
  paused: boolean;
  max?: number;
  /** tokenAddress (lowercase) -> decimals; quantity shows em-dash when unknown. */
  decimalsMap?: Record<string, number>;
}) {
  const [trades, setTrades] = useState<Trade[]>(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useLiveFeed({
    channels: ['trade'],
    ...(tokenFilter ? { tokens: [tokenFilter] } : {}),
    paused,
    onFrame: (frame) => {
      if (frame.type !== 'trade') return;
      const t = frame.data as Trade;
      if (tokenFilter && t.tokenAddress.toLowerCase() !== tokenFilter.toLowerCase()) return;
      setTrades((prev) => {
        if (prev.some((p) => p.id === t.id)) return prev;
        return [t, ...prev].slice(0, max);
      });
      setFresh((prev) => new Set(prev).add(t.id));
      setTimeout(
        () =>
          setFresh((prev) => {
            const next = new Set(prev);
            next.delete(t.id);
            return next;
          }),
        1500,
      );
    },
  });

  if (trades.length === 0)
    return <EmptyState message="No trades yet — the feed fills as swaps arrive." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-2 py-1.5 font-medium">Side</th>
            <th className="px-2 py-1.5 font-medium">Token</th>
            <th className="px-2 py-1.5 font-medium">Wallet</th>
            <th className="px-2 py-1.5 font-medium">Class</th>
            <th className="px-2 py-1.5 text-right font-medium">Value</th>
            <th className="px-2 py-1.5 text-right font-medium">Quantity</th>
            <th className="px-2 py-1.5 font-medium">DEX</th>
            <th className="px-2 py-1.5 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr
              key={t.id}
              className={`border-b border-edge/50 tabular-nums transition-colors duration-700 ${
                fresh.has(t.id) ? (t.side === 'BUY' ? 'bg-pos/10' : 'bg-neg/10') : ''
              }`}
            >
              <td className="px-2 py-1.5">
                <Badge tone={t.side === 'BUY' ? 'pos' : 'neg'}>{t.side}</Badge>
              </td>
              <td className="px-2 py-1.5">
                <Link href={`/token/${t.tokenAddress}`} className="font-medium hover:text-info">
                  {t.tokenSymbol}
                </Link>
              </td>
              <td className="px-2 py-1.5 font-mono text-xs">
                <Link href={`/wallet/${t.traderAddress}`} className="hover:text-info">
                  {shortAddr(t.traderAddress)}
                </Link>
              </td>
              <td className="px-2 py-1.5">
                <ClassChip walletClass={t.walletClass} />
              </td>
              <td className="px-2 py-1.5 text-right">
                {t.valueUsd === null ? '—' : usd(t.valueUsd, { compact: true })}
              </td>
              <td className="px-2 py-1.5 text-right text-muted">
                {(() => {
                  const dec = decimalsMap?.[t.tokenAddress.toLowerCase()];
                  return dec === undefined
                    ? '—'
                    : `${rawAmount(t.tokenAmount, dec)} ${t.tokenSymbol}`;
                })()}
              </td>
              <td className="px-2 py-1.5 text-xs text-muted">{t.dexName}</td>
              <td className="px-2 py-1.5 text-right text-xs text-muted">
                <a
                  href={txUrl(t.transactionHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-info"
                >
                  {timeAgo(t.blockTimestamp)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
