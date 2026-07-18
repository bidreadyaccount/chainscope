/**
 * No-dead-navigation smoke test (added after re-audit R-04). Parses the nav bar's
 * internal hrefs and asserts each one resolves to an App Router page on disk, so a
 * shipped nav link can never again point to a missing route (which is exactly how
 * `/build` slipped through — the page existed locally but was git-ignored, so the
 * pushed build had a dead link). Reads source as text — no React/Next imports —
 * so it runs in a plain node environment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, 'app');

function navHrefs(): string[] {
  const navSrc = readFileSync(join(here, 'components', 'nav.tsx'), 'utf8');
  const hrefs = new Set<string>();
  for (const m of navSrc.matchAll(/href:\s*'([^']+)'/g)) hrefs.add(m[1]!);
  return [...hrefs];
}

/** Does an App Router page exist for a static internal route like `/build`? */
function pageExists(route: string): boolean {
  if (!route.startsWith('/')) return false;
  const segments = route.replace(/^\//, '').split('/').filter(Boolean);
  const dir = join(appDir, ...segments);
  return existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'page.jsx'));
}

describe('nav bar has no dead links', () => {
  const hrefs = navHrefs();

  it('parses the nav hrefs', () => {
    expect(hrefs.length).toBeGreaterThan(3);
    expect(hrefs).toContain('/build');
  });

  it.each(navHrefs())('route %s has an App Router page', (href) => {
    // Skip dynamic/external; nav only contains static internal routes today.
    if (!href.startsWith('/') || href.includes('[')) return;
    expect(pageExists(href), `no page.tsx for nav route ${href}`).toBe(true);
  });
});
