import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { NavBar } from '@/components/nav';

export const metadata: Metadata = {
  title: 'ChainScope — Robinhood Chain market intelligence',
  description:
    'Real-time onchain market intelligence and wallet analytics for Robinhood Chain. Analytics and decision support — not financial advice.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <NavBar />
          <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
          <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-4 text-xs text-muted">
            ChainScope is read-only analytics and decision support, not financial advice. Scores
            and wallet labels are model outputs with stated confidence — verify before acting.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
