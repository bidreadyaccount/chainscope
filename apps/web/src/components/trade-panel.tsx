'use client';

/**
 * Trade panel for an index (buyable layer preview). Builds a real buy/sell plan via
 * the trade planner behind /indexes/:slug/plan and shows the per-name swaps, the
 * 0.1% fee, and totals. The execute button is intentionally inert — nothing is
 * submitted until verified Robinhood Chain addresses are configured. Read-only.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type IndexConstituentView, type TradePlanResult } from '@/lib/api';
import { usd } from '@/lib/format';
import { Card, ErrorState, Skeleton } from './ui';

const PRESETS = [100, 500, 1000, 5000];
const ACTIONS = [
  { key: 'BUY', label: 'Buy' },
  { key: 'SELL', label: 'Sell' },
] as const;
type Action = (typeof ACTIONS)[number]['key'];

export function TradePanel({
  slug,
  constituents,
}: {
  slug: string;
  constituents: IndexConstituentView[];
}) {
  const [action, setAction] = useState<Action>('BUY');
  const [amount, setAmount] = useState(1000);

  // For SELL there is no connected wallet in preview mode, so synthesize the holdings
  // of a $amount position in this basket from its current weights + prices.
  const holdings = useMemo(() => {
    if (action !== 'SELL') return undefined;
    return constituents
      .filter((c) => c.priceUsd && c.priceUsd > 0)
      .map((c) => ({
        ticker: c.ticker,
        qty: ((c.weightBps / 10000) * amount) / (c.priceUsd as number),
      }));
  }, [action, amount, constituents]);

  const plan = useQuery({
    queryKey: ['plan', slug, action, amount],
    queryFn: () =>
      api.plan(
        slug,
        action === 'BUY' ? { action: 'BUY', amountUsd: amount } : { action: 'SELL', holdings },
      ),
    enabled: amount > 0,
  });

  return (
    <Card title="Trade this basket (preview)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-edge">
          {ACTIONS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAction(a.key)}
              className={`px-3 py-1 text-xs ${
                action === a.key ? 'bg-edge text-bright' : 'text-muted hover:text-bright'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
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
          <span>{action === 'SELL' ? 'position to sell' : 'to invest'}</span>
        </label>
      </div>

      {plan.isLoading ? (
        <Skeleton rows={5} />
      ) : plan.isError ? (
        <ErrorState message={(plan.error as Error).message} />
      ) : plan.data && !plan.data.ok ? (
        <p className="text-sm text-warn">
          Could not build a plan: {plan.data.error ?? 'invalid input'}.
        </p>
      ) : plan.data ? (
        <PlanBody data={plan.data} />
      ) : null}
    </Card>
  );
}

function PlanBody({ data }: { data: TradePlanResult }) {
  const isBuy = data.action === 'BUY';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm tabular-nums">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted">
            {isBuy ? 'You pay' : 'You receive (gross)'}
          </div>
          <div className="text-lg">{usd(isBuy ? data.grossBuyUsd : data.grossSellUsd)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted">
            Fee ({(data.feeBps / 100).toFixed(2)}%)
          </div>
          <div className="text-lg">{usd(data.feeUsd)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted">Swaps</div>
          <div className="text-lg">{data.trades.length}</div>
        </div>
      </div>

      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="py-1 font-medium">Ticker</th>
            <th className="py-1 text-right font-medium">Side</th>
            <th className="py-1 text-right font-medium">Amount</th>
            <th className="py-1 text-right font-medium">Est. shares</th>
          </tr>
        </thead>
        <tbody>
          {data.trades
            .slice()
            .sort((a, b) => b.amountUsd - a.amountUsd)
            .map((t) => (
              <tr key={t.ticker} className="border-b border-edge/40">
                <td className="py-1 font-medium">{t.ticker}</td>
                <td className={`py-1 text-right ${t.side === 'BUY' ? 'text-pos' : 'text-neg'}`}>
                  {t.side}
                </td>
                <td className="py-1 text-right">{usd(t.amountUsd)}</td>
                <td className="py-1 text-right text-muted">
                  {t.estQty.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {data.excluded.length > 0 ? (
        <p className="text-xs text-warn">
          Excluded (no price): {data.excluded.map((e) => e.ticker).join(', ')}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-edge/50 pt-3">
        <button
          disabled
          title={data.executionDisabledReason}
          className="cursor-not-allowed rounded border border-edge px-3 py-1.5 text-xs text-muted opacity-60"
        >
          {isBuy ? 'Execute buy' : 'Execute sell'}
        </button>
        <span className="text-[11px] text-muted">
          Preview only — nothing is submitted. Execution turns on once verified Robinhood Chain
          addresses are configured. Tokens would settle to your own wallet; not investment advice.
        </span>
      </div>
    </div>
  );
}
