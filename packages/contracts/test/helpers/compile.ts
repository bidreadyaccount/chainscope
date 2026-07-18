/**
 * Compile every .sol under src/ and test/mocks/ with the pure-JS solc (no native
 * binary, no external download — the sandbox blocks the solc binary host). OZ
 * imports resolve from node_modules; local imports resolve from the source map.
 */
import solc from 'solc';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // test/helpers/
const ROOT = resolve(HERE, '..', '..'); // packages/contracts
const NM = resolve(ROOT, 'node_modules');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.sol')) out.push(p);
  }
  return out;
}

export interface Compiled {
  abi: unknown[];
  bytecode: string;
}

let cache: Record<string, Compiled> | null = null;

/** Compile the whole contract set once and return { ContractName: { abi, bytecode } }. */
export function compileAll(): Record<string, Compiled> {
  if (cache) return cache;
  const files = [...walk(resolve(ROOT, 'src')), ...walk(resolve(ROOT, 'test', 'mocks'))];
  const sources: Record<string, { content: string }> = {};
  for (const f of files) {
    const key = relative(ROOT, f).split('\\').join('/');
    sources[key] = { content: readFileSync(f, 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Target 'paris' (pre-PUSH0) so the bytecode runs on ganache's EVM without
      // needing a Shanghai+ hardfork.
      evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  function findImports(path: string): { contents: string } | { error: string } {
    try {
      const base = path.startsWith('@') ? join(NM, path) : resolve(ROOT, path);
      return { contents: readFileSync(base, 'utf8') };
    } catch {
      return { error: 'not found: ' + path };
    }
  }
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors: Array<{ severity: string; formattedMessage: string }> = (out.errors ?? []).filter(
    (e: { severity: string }) => e.severity === 'error',
  );
  if (errors.length) throw new Error('solc errors:\n' + errors.map((e) => e.formattedMessage).join('\n'));

  const result: Record<string, Compiled> = {};
  for (const file of Object.keys(out.contracts ?? {})) {
    for (const name of Object.keys(out.contracts[file])) {
      const c = out.contracts[file][name];
      if (c.evm?.bytecode?.object) {
        result[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
      }
    }
  }
  cache = result;
  return result;
}
