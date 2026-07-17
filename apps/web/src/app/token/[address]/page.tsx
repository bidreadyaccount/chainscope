'use client';

/**
 * Token Detail (SPEC §14.E, core-MVP scope): summary, chart of recent priced
 * trades, opportunity + risk scores WITH full component/penalty breakdown and
 * deterministic explanations, live trade feed, net-flow-by-class panel.
 */

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { api, WINDOWS, type TokenScore, type Window } from '@/lib/api';
import { flow, pct, usd } from '@/lib/format';
import { Badge, Card, ErrorState, FlowText, Hint, ScoreBadge, Skeleton } from '@/components/ui';
import { TradeFeed } from '@/components/trade-feed';
import { PriceChart } from '@/components/price-chart';

const COMPONENT_LABELS: Record<string, string> = {
  smartMoneyNetFlow: 'Smart-money net flow',
  whaleNetFlow: 'Whale net flow',
  uniqueBuyerGrowth: 'Unique-buyer growth',
  buySellImbalance: 'Buy/sell imbalance',
  liquidityGrowth: 'Liquidity growth',
  buyerQualityImprovement: 'Buyer-quality improvement',
  volumeAcceleration: 'Volume acceleration',
  priceConfirmation: 'Price confirmation',
};

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [window_, setWindow] = useState<Window>('24h');
  const [paused, setPaused] = useState(false);

  const token = useQuery({ queryKey: ['token', address], queryFn: () => api.token(address) });
  const score = useQuery({
    queryKey: ['score', address, window_],
    queryFn: () => api.tokenScore(address, window_),
    refetchInterval: paused ? false : 15_000,
  });
  const trades = useQuery({
    queryKey: ['token-trades', address],
    queryFn: () => api.tokenTrades(address, 40),
  });

  if (token.isLoading) return <Skeleton rows={10} />;
  if (token.isError) return <ErrorState message={(token.error as Error).message} />;
  const t = token.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">
          {t.symbol} <span className="text-sm font-normal text-muted">{t.name}</span>
        </h1>
        {t.priceUsd === null ? (
          <Badge tone="warn">Insufficient pricing data</Badge>
        ) : (
          <span className="text-lg tabular-nums">{usd(t.priceUsd)}</span>
        )}
        <span className="text-sm text-muted">
          Liquidity {usd(t.liquidityUsd, { compact: true })}
          {t.liquidityChangePct !== null && (
            <FlowText value={t.liquidityChangePct} text={` (${pct(t.liquidityChangePct)})`} />
          )}
        </span>
        {t.isVerified ? (
          <Badge tone="info">Verified contract</Badge>
        ) : (
          <Badge tone="warn">Unverified contract</Badge>
        )}
        <a
          href={t.explorer.token}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-info hover:underline"
        >
          Explorer ↗
        </a>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded border border-edge">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-2 py-1 text-xs ${w === window_ ? 'bg-edge text-bright' : 'text-muted hover:text-bright'}`}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex items-center gap-1 rounded border border-edge px-2 py-1 text-xs text-muted hover:text-bright"
          >
            {paused ? <Play size={11} /> : <Pause size={11} />}
            {paused ? 'Paused' : 'Live'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent trade prices">
          {trades.isLoading ? (
            <Skeleton rows={5} />
          ) : (
            <PriceChart trades={trades.data?.items ?? []} />
          )}
        </Card>

        <Card
          title={`Opportunity score — ${window_}`}
          right={
            score.data ? (
              <span className="flex items-center gap-2 text-xs text-muted">
                <ScoreBadge score={score.data.opportunityScore} signal={score.data.signal} />
                {score.data.signal} · risk {Math.round(score.data.riskScore)}
              </span>
            ) : undefined
          }
        >
          {score.isLoading ? (
            <Skeleton rows={6} />
          ) : score.isError ? (
            <ErrorState message={(score.error as Error).message} />
          ) : (
            <ScoreBreakdown data={score.data!} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Live trades">
            {trades.isLoading ? (
              <Skeleton rows={6} />
            ) : (
              <TradeFeed
                initial={trades.data?.items ?? []}
                tokenFilter={address}
                paused={paused}
                decimalsMap={{ [address.toLowerCase()]: t.decimals }}
              />
            )}
          </Card>
        </div>
        <Card title="Net flow by wallet class">
          <dl className="space-y-2 text-sm tabular-nums">
            {(
              [
                ['Whales', t.whaleNetFlowUsd, 'Net USD flow from whale-classified wallets'],
                ['Smart money', t.smartMoneyNetFlowUsd, 'Wallets with strong verified history'],
                ['Retail', t.retailNetFlowUsd, 'Small-portfolio wallets'],
                ['New wallets', t.newWalletNetFlowUsd, 'Wallets first seen within 7 days'],
                [
                  'Deployer-linked',
                  t.deployerLinkedNetFlowUsd,
                  'Wallets linked to the token deployer — selling here is a risk signal',
                ],
              ] as const
            ).map(([label, value, hint]) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-edge/50 pb-2"
              >
                <dt className="text-muted">
                  <Hint label={label} hint={hint} />
                </dt>
                <dd>
                  <FlowText value={value} text={flow(value)} />
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <dt className="text-muted">Buyers / sellers</dt>
              <dd>
                {t.uniqueBuyers} / {t.uniqueSellers}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function ScoreBreakdown({ data }: { data: TokenScore }) {
  return (
    <div className="space-y-3 text-sm">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="py-1 pr-2 font-medium">Component</th>
            <th className="py-1 pr-2 text-right font-medium">Normalized</th>
            <th className="py-1 pr-2 text-right font-medium">Weight</th>
            <th className="py-1 text-right font-medium">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {data.components.map((c) => (
            <tr key={c.key} className="border-b border-edge/40">
              <td className="py-1 pr-2">{COMPONENT_LABELS[c.key] ?? c.key}</td>
              <td className="py-1 pr-2 text-right text-muted">{c.normalized.toFixed(2)}</td>
              <td className="py-1 pr-2 text-right text-muted">{pct(c.weight, 0)}</td>
              <td className="py-1 text-right">{c.contribution.toFixed(1)}</td>
            </tr>
          ))}
          {data.penalties.map((p) => (
            <tr key={p.key} className="border-b border-edge/40 text-warn">
              <td className="py-1 pr-2" title={p.evidence}>
                Penalty: {p.key}
              </td>
              <td className="py-1 pr-2 text-right">sev {p.severity.toFixed(2)}</td>
              <td className="py-1 pr-2 text-right">max {p.maxPenalty}</td>
              <td className="py-1 text-right">−{p.applied.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-pos">
            Positive factors
          </h3>
          <ul className="space-y-1 text-[13px] text-bright/90">
            {data.explanations.positiveFactors.length === 0 ? (
              <li className="text-muted">None detected in this window.</li>
            ) : (
              data.explanations.positiveFactors.map((f) => <li key={f}>• {f}</li>)
            )}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-warn">
            Risk factors
          </h3>
          <ul className="space-y-1 text-[13px] text-bright/90">
            {data.explanations.riskFactors.length === 0 ? (
              <li className="text-muted">None detected in this window.</li>
            ) : (
              data.explanations.riskFactors.map((f) => <li key={f}>• {f}</li>)
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
