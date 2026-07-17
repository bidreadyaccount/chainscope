import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseEnv,
  safeParseEnv,
  loadEnv,
  resetEnvCache,
  isLiveMode,
  isDemoMode,
  parseStablecoins,
} from './env.js';

const base = {
  DATABASE_URL: 'postgresql://chainscope:chainscope@localhost:5432/chainscope',
  REDIS_URL: 'redis://localhost:6379',
};

describe('env validation', () => {
  beforeEach(() => resetEnvCache());

  it('applies defaults and defaults DATA_MODE to demo', () => {
    const env = parseEnv(base);
    expect(env.DATA_MODE).toBe('demo');
    expect(env.API_PORT).toBe(4000);
    expect(env.CHAIN_CONFIRMATIONS).toBe(5);
    expect(env.LOG_LEVEL).toBe('info');
    expect(isDemoMode(env)).toBe(true);
    expect(isLiveMode(env)).toBe(false);
  });

  it('rejects missing required datastore URLs', () => {
    const res = safeParseEnv({ REDIS_URL: 'redis://localhost:6379' });
    expect(res.success).toBe(false);
  });

  it('rejects a non-URL DATABASE_URL', () => {
    const res = safeParseEnv({ ...base, DATABASE_URL: 'not-a-url' });
    expect(res.success).toBe(false);
  });

  it('requires ROBINHOOD_RPC_URL in live mode', () => {
    const res = safeParseEnv({ ...base, DATA_MODE: 'live' });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('ROBINHOOD_RPC_URL'))).toBe(true);
    }
  });

  it('accepts live mode when RPC URL is supplied', () => {
    const env = parseEnv({
      ...base,
      DATA_MODE: 'live',
      ROBINHOOD_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
    });
    expect(isLiveMode(env)).toBe(true);
    expect(env.ROBINHOOD_RPC_URL).toBe('https://rpc.mainnet.chain.robinhood.com');
  });

  it('coerces numeric ports and rejects out-of-range ports', () => {
    const env = parseEnv({ ...base, API_PORT: '5555' });
    expect(env.API_PORT).toBe(5555);
    expect(safeParseEnv({ ...base, API_PORT: '99999' }).success).toBe(false);
  });

  it('treats empty optional address strings as undefined', () => {
    const env = parseEnv({ ...base, ROBINHOOD_UNIV2_ROUTER: '' });
    expect(env.ROBINHOOD_UNIV2_ROUTER).toBeUndefined();
  });

  it('splits WEB_ORIGIN into a trimmed array', () => {
    const env = parseEnv({ ...base, WEB_ORIGIN: 'http://a.com, http://b.com' });
    expect(env.WEB_ORIGIN).toEqual(['http://a.com', 'http://b.com']);
  });

  it('parses stablecoins into a lowercased list', () => {
    const env = parseEnv({ ...base, ROBINHOOD_STABLECOINS: '0xAAA, 0xBbB' });
    expect(parseStablecoins(env)).toEqual(['0xaaa', '0xbbb']);
    expect(parseStablecoins(parseEnv(base))).toEqual([]);
  });

  it('caches loadEnv and resets on demand', () => {
    const first = loadEnv({ ...base, API_PORT: '4001' } as NodeJS.ProcessEnv);
    const second = loadEnv({ ...base, API_PORT: '4999' } as NodeJS.ProcessEnv);
    expect(second.API_PORT).toBe(first.API_PORT); // cached
    resetEnvCache();
    const third = loadEnv({ ...base, API_PORT: '4999' } as NodeJS.ProcessEnv);
    expect(third.API_PORT).toBe(4999);
  });

  it('throws a readable aggregated error from loadEnv', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/Invalid environment configuration/);
  });
});
