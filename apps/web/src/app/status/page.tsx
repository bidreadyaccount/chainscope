'use client';

/** Data Status page (SPEC §14.I, core-MVP): system + indexer health, auto-refresh. */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { num, timeAgo } from '@/lib/format';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';

function StateBadge({ ok, okText = 'ok', badText = 'down' }: { ok: boolean; okText?: string; badText?: string }) {
  return <Badge tone={ok ? 'pos' : 'neg'}>{ok ? okText : badText}</Badge>;
}

export default function StatusPage() {
  const q = useQuery({ queryKey: ['status-page'], queryFn: api.status, refetchInterval: 5_000 });

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  const s = q.data!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Data Status</h1>
        {s.mode === 'demo' ? (
          <Badge tone="warn" title="Deterministic demo data — not live blockchain data">
            Demo Data
          </Badge>
        ) : (
          <Badge tone="pos">Live</Badge>
        )}
        <span className="text-xs text-muted">uptime {num(Math.floor(s.uptimeSeconds / 60))}m · auto-refreshes every 5s</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Datastores">
          <dl className="space-y-2 text-sm">
            <Row label="PostgreSQL">
              <StateBadge ok={s.datastores.database.status === 'ok'} />
              <span className="text-xs text-muted">{s.datastores.database.latencyMs ?? '—'}ms</span>
            </Row>
            <Row label="Redis">
              <StateBadge ok={s.datastores.redis.status === 'ok'} />
              <span className="text-xs text-muted">{s.datastores.redis.latencyMs ?? '—'}ms</span>
            </Row>
          </dl>
        </Card>

        <Card title="Chain connection">
          <dl className="space-y-2 text-sm">
            <Row label="Chain">
              <span>
                {s.chain.name} ({s.chain.id})
              </span>
            </Row>
            <Row label="RPC configured">
              <StateBadge ok={s.rpc.configured} okText="yes" badText="no" />
            </Row>
            <Row label="WebSocket configured">
              <StateBadge ok={s.rpc.websocketConfigured} okText="yes" badText="no" />
            </Row>
            {!s.chain.verified && (
              <p className="text-xs text-warn">
                Network parameters unverified — operators must confirm against official Robinhood
                Chain docs before live use.
              </p>
            )}
          </dl>
        </Card>

        <Card title="Indexer">
          <dl className="space-y-2 text-sm tabular-nums">
            <Row label="Running">
              <StateBadge ok={s.indexer.running} okText="yes" badText="no" />
            </Row>
            <Row label="Last indexed block">
              <span>{s.indexer.lastIndexedBlock}</span>
            </Row>
            <Row label="Chain head">
              <span>{s.indexer.headBlock ?? '—'}</span>
            </Row>
            <Row label="Lag">
              <span className={s.indexer.lagBlocks && BigInt(s.indexer.lagBlocks) > 25n ? 'text-warn' : ''}>
                {s.indexer.lagBlocks ?? '—'} blocks
              </span>
            </Row>
            <Row label="Confirmations">
              <span>{s.indexer.confirmations}</span>
            </Row>
          </dl>
        </Card>

        {s.demoStream ? (
          <Card title="Demo stream">
            <dl className="space-y-2 text-sm tabular-nums">
              <Row label="Running">
                <StateBadge ok={s.demoStream.running} okText="yes" badText="no" />
              </Row>
              <Row label="Trades ingested">
                <span>{num(s.demoStream.ingested)}</span>
              </Row>
              <Row label="Last trade">
                <span>{s.demoStream.lastTradeAt ? timeAgo(s.demoStream.lastTradeAt) : '—'}</span>
              </Row>
              <Row label="Interval">
                <span>{s.demoStream.intervalMs}ms</span>
              </Row>
            </dl>
          </Card>
        ) : null}

        <Card title="DEX adapters">
          {s.adapters.length === 0 ? (
            <p className="text-sm text-muted">
              No adapters configured — live decoding inactive until verified addresses are
              supplied.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.adapters.map((a) => (
                <li key={a.name} className="flex items-center justify-between">
                  <span>
                    {a.name} <span className="text-xs text-muted">({a.protocol})</span>
                  </span>
                  <span className="flex gap-1.5">
                    {a.isDemo ? <Badge tone="warn">demo</Badge> : null}
                    <StateBadge ok={a.enabled} okText="enabled" badText="disabled" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Data coverage">
          <dl className="space-y-2 text-sm tabular-nums">
            <Row label="Tokens tracked">
              <span>{num(s.coverage.tokens)}</span>
            </Row>
            <Row label="Trades stored">
              <span>{num(s.coverage.trades)}</span>
            </Row>
            <Row label="Wallets observed">
              <span>{num(s.coverage.wallets)}</span>
            </Row>
            <Row label="Positions tracked">
              <span>{num(s.coverage.positions)}</span>
            </Row>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-edge/50 pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-2">{children}</dd>
    </div>
  );
}
