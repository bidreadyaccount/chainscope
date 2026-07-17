import { describe, it, expect } from 'vitest';
import {
  serializeForWire,
  stringifyForWire,
  stringifyTagged,
  parseTagged,
  encodeTagged,
  decodeTagged,
} from './bigint.js';

describe('BigInt-safe serialization', () => {
  it('serializeForWire converts bigint to string and Date to ISO', () => {
    const d = new Date('2025-01-02T03:04:05.000Z');
    const out = serializeForWire({
      n: 10n,
      big: 123456789012345678901234567890n,
      when: d,
      s: 'x',
      k: 3,
    });
    expect(out).toEqual({
      n: '10',
      big: '123456789012345678901234567890',
      when: '2025-01-02T03:04:05.000Z',
      s: 'x',
      k: 3,
    });
  });

  it('stringifyForWire never throws on bigint', () => {
    expect(() => stringifyForWire({ v: 2n ** 64n })).not.toThrow();
    expect(JSON.parse(stringifyForWire({ v: 2n ** 64n }))).toEqual({ v: '18446744073709551616' });
  });

  it('tagged codec round-trips bigint exactly', () => {
    const value = {
      blockNumber: 18446744073709551616n,
      nested: { amounts: [1n, 2n, 3n], note: 'ok' },
      when: new Date('2024-06-01T00:00:00.000Z'),
      nothing: null,
      flag: true,
    };
    const restored = parseTagged<typeof value>(stringifyTagged(value));
    expect(restored).toEqual(value);
    expect(restored.blockNumber).toBe(18446744073709551616n);
    expect(restored.nested.amounts[0]).toBe(1n);
    expect(restored.when instanceof Date).toBe(true);
  });

  it('encode/decode are inverse for arrays of bigint', () => {
    const arr = [0n, -5n, 999999999999999999999n];
    expect(decodeTagged(encodeTagged(arr))).toEqual(arr);
  });

  it('leaves plain JSON untouched through the tagged codec', () => {
    const plain = { a: 1, b: 'two', c: [true, false], d: null };
    expect(parseTagged(stringifyTagged(plain))).toEqual(plain);
  });
});
