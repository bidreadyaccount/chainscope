'use client';

/**
 * Wallet Detail (SPEC §14.F, core-MVP scope): hedged labels with confidence +
 * reasons, portfolio estimate, P&L, win rate, positions, recent trades, bot
 * indicators, funding relationships, explorer link.
 */

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { flow, num, pct, shortAddr, timeAgo, usd } from '@/lib/format';
import { Badge, Card, ClassChip, EmptyState, ErrorState, FlowText, Hint, Skeleton } from '@/components/ui';
import { TradeFeed } from '@/components/trade-feed';

export default function WalletPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const wallet = useQuery({ queryKey: ['wallet', address], queryFn: () => api.wallet(address) });
  const positions = useQuery({
    queryKey: ['wallet-pos', address],
    queryFn: () => api.walletPositions(address),
  });
  const trades = useQuery({
    queryKey: ['wallet-trades', address],
    queryFn: () => api.walletTrades(address, 25),
  });

  if (wallet.isLoading) return <Skeleton rows={10} />;
  if (wallet.isError) return <ErrorState message={(wallet.error as Error).message} />;
  const w = wallet.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-lg">{shortAddr(w.address)}</h1>
        <ClassChip walletClass={w.primaryClass} />
        <span className="text-xs text-muted">confidence {w.classificationConfidence}</span>
        {w.botProbability >= 40 ? (
          <Badge tone="warn" title="Explainable bot indicators — see panel below">
            Possible bot ({w.botProbability})
          </Badge>
        ) : null}
        <a href={w.explorer.address} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline">
          Explorer ↗
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Portfolio estimate" hint="Estimated total value across tracked positions" value={usd(w.portfolioEstimateUsd, { compact: true })} />
        <Stat
          label="Realized P&L"
          hint="Profit and loss on closed position portions (weighted-average cost basis)"
          value={<FlowText value={w.realizedPnlUsd} text={flow(w.realizedPnlUsd)} />}
        />
        <Stat
          label="Unrealized P&L"
          hint="Open-position P&L at current prices"
          value={<FlowText value={w.unrealizedPnlUsd} text={flow(w.unrealizedPnlUsd)} />}
        />
        <Stat
          label="Win rate"
          hint={`${w.winningPositions} winning / ${w.losingPositions} losing closed positions`}
          value={w.closedPositions > 0 ? pct(w.winRate) : '—'}
        />
        <Stat label="Trades observed" value={num(w.tradeCount)} />
        <Stat label="Avg trade size" value={usd(w.avgTradeSizeUsd, { compact: true })} />
        <Stat label="First seen" value={w.firstSeenAt ? timeAgo(w.firstSeenAt) : '—'} />
        <Stat
          label="Smart-money status"
          hint="Requires a minimum trade sample before any smart-money status is assigned"
          value={w.smartMoney.sampleSizeMet ? `${w.smartMoney.status} (${Math.round(w.smartMoney.score)})` : 'Insufficient history'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Classification labels">
          {w.labels.length === 0 ? (
            <EmptyState message="No labels — insufficient history." />
          ) : (
            <ul className="space-y-3">
              {w.labels.map((l) => (
                <li key={l.class} className="border-b border-edge/50 pb-2">
                  <div className="flex items-center gap-2">
                    <ClassChip walletClass={l.class} />
                    <span className="text-xs text-muted">confidence {l.confidence}</span>
                  </div>
                  <ul className="mt-1 text-[13px] text-bright/85">
                    {l.reasons.map((r) => (
                      <li key={r}>• {r}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Bot probability" right={<span className="text-xs text-muted">{w.botProbability}/100</span>}>
          <ul className="space-y-1.5 text-[13px]">
            {w.botIndicators.map((i) => (
              <li key={i.key} className="flex items-center justify-between">
                <span className={i.triggered ? 'text-warn' : 'text-muted'}>
                  {i.triggered ? '⚠ ' : '· '}
                  {i.detail}
                </span>
                <span className="text-xs text-muted">w{i.weight}</span>
              </li>
            ))}
          </ul>
          {w.fundingSourceAddress ? (
            <p className="mt-3 border-t border-edge/50 pt-2 text-[13px] text-muted">
              <Hint label="Related funding source" hint="Wallets funded by the same source may be related — presented as evidence, not fact" />
              :{' '}
              <Link href={`/wallet/${w.fundingSourceAddress}`} className="font-mono text-info hover:underline">
                {shortAddr(w.fundingSourceAddress)}
              </Link>{' '}
              ({w.fundingSourcePeerCount} peer wallets)
            </p>
          ) : null}
          {w.deployerRelationships.length > 0 ? (
            <p className="mt-2 text-[13px] text-warn">
              Deployer-linked evidence present ({w.deployerRelationships.length} item
              {w.deployerRelationships.length > 1 ? 's' : ''}).
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="Positions">
        {positions.isLoading ? (
          <Skeleton rows={4} />
        ) : (positions.data?.items.length ?? 0) === 0 ? (
          <EmptyState message="No tracked positions." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-2 py-1.5 font-medium">Token</th>
                  <th className="px-2 py-1.5 text-right font-medium">Quantity</th>
                  <th className="px-2 py-1.5 text-right font-medium">Value</th>
                  <th className="px-2 py-1.5 text-right font-medium">Avg entry</th>
                  <th className="px-2 py-1.5 text-right font-medium">Realized</th>
                  <th className="px-2 py-1.5 text-right font-medium">Unrealized</th>
                  <th className="px-2 py-1.5 text-right font-medium">W/L</th>
                  <th className="px-2 py-1.5 text-right font-medium">Complete</th>
                </tr>
              </thead>
              <tbody>
                {(positions.data?.items ?? []).map((p) => (
                  <tr key={p.tokenAddress} className="border-b border-edge/50">
                    <td className="px-2 py-1.5">
                      <Link href={`/token/${p.tokenAddress}`} className="font-medium hover:text-info">
                        {p.tokenSymbol}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-right">{p.currentQty.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                    <td className="px-2 py-1.5 text-right">{usd(p.currentValueUsd, { compact: true })}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{usd(p.avgEntryCostUsd)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <FlowText value={p.realizedPnlUsd} text={flow(p.realizedPnlUsd)} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <FlowText value={p.unrealizedPnlUsd} text={flow(p.unrealizedPnlUsd)} />
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">
                      {p.winningClosed}/{p.losingClosed}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {p.isComplete ? (
                        <span className="text-muted">yes</span>
                      ) : (
                        <Badge tone="warn" title="History incomplete — figures may understate activity">
                          partial
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent trades">
        {trades.isLoading ? (
          <Skeleton rows={4} />
        ) : (
          <TradeFeed initial={trades.data?.items ?? []} paused={true} />
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-edge bg-panel px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">
        {hint ? <Hint label={label} hint={hint} /> : label}
      </div>
      <div className="mt-0.5 text-[15px] tabular-nums">{value}</div>
    </div>
  );
}
