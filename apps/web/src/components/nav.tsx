'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Gauge, LayoutGrid, Layers, Radio } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from './ui';

const LINKS = [
  { href: '/', label: 'Market', icon: LayoutGrid },
  { href: '/indexes', label: 'Indexes', icon: Layers },
  { href: '/trades', label: 'Live Trades', icon: Radio },
  { href: '/methodology', label: 'Methodology', icon: BookOpen },
  { href: '/status', label: 'Status', icon: Gauge },
];

export function NavBar() {
  const pathname = usePathname();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 30_000 });

  return (
    <nav className="sticky top-0 z-20 border-b border-edge bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 px-4 py-2.5">
        <Link href="/" className="mr-4 flex items-center gap-2 text-[15px] font-semibold">
          <Activity size={18} className="text-info" aria-hidden />
          ChainScope
        </Link>
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] ${
                active ? 'bg-edge text-bright' : 'text-muted hover:text-bright'
              }`}
            >
              <Icon size={14} aria-hidden />
              {label}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {status.data?.mode === 'demo' ? (
            <Badge tone="warn" title="Deterministic demo data — not live blockchain data">
              Demo Data
            </Badge>
          ) : status.data?.mode === 'live' ? (
            <Badge tone="pos">Live</Badge>
          ) : null}
          <Badge tone="muted" title="Robinhood Chain (chain ID 4663)">
            Robinhood Chain
          </Badge>
        </div>
      </div>
    </nav>
  );
}
