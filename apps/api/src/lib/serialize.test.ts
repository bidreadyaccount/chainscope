import { describe, it, expect } from 'vitest';
import { stringifyForWire, serializeForWire } from '@chainscope/shared';

describe('BigInt-safe serialization (API wire)', () => {
  it('renders bigint as a decimal string through JSON', () => {
    const obj = { blockNumber: 123456789012345678901234567890n, nested: { x: 42n } };
    const json = stringifyForWire(obj);
    const parsed = JSON.parse(json) as { blockNumber: string; nested: { x: string } };
    expect(parsed.blockNumber).toBe('123456789012345678901234567890');
    expect(parsed.nested.x).toBe('42');
  });

  it('renders Date as ISO string and drops undefined', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    const out = serializeForWire({ at: d, gone: undefined, keep: 1 }) as Record<string, unknown>;
    expect(out.at).toBe('2026-01-02T03:04:05.000Z');
    expect('gone' in out).toBe(false);
    expect(out.keep).toBe(1);
  });

  it('never throws on a trade-shaped object with bigint + Date', () => {
    const trade = {
      id: 't1',
      blockNumber: 999n,
      blockTimestamp: new Date(0),
      valueUsd: 1234.56,
      priceUsd: null,
    };
    expect(() => stringifyForWire(trade)).not.toThrow();
    const parsed = JSON.parse(stringifyForWire(trade));
    expect(parsed.blockNumber).toBe('999');
    expect(parsed.priceUsd).toBeNull();
  });
});
