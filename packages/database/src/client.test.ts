import { describe, it, expect } from 'vitest';
import { serializeBigInt, stringifyBigInt, bigIntJsonReplacer } from './client.js';

describe('database serialization helpers', () => {
  it('serializeBigInt converts bigint columns to strings', () => {
    expect(serializeBigInt({ blockNumber: 5_000_123n, valueUsd: 42.5 })).toEqual({
      blockNumber: '5000123',
      valueUsd: 42.5,
    });
  });

  it('stringifyBigInt never throws on bigint', () => {
    expect(() => stringifyBigInt({ n: 10n })).not.toThrow();
    expect(JSON.parse(stringifyBigInt({ n: 10n }))).toEqual({ n: '10' });
  });

  it('bigIntJsonReplacer works with JSON.stringify', () => {
    expect(JSON.stringify({ a: 7n }, bigIntJsonReplacer)).toBe('{"a":"7"}');
  });
});
