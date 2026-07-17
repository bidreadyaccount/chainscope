import { describe, it, expect } from 'vitest';
import {
  OPPORTUNITY_WEIGHTS,
  SMART_MONEY_WEIGHTS,
  SIGNAL_BANDS,
  signalLabel,
  PRICE_SOURCE_CONFIDENCE,
} from './thresholds.js';

const sum = (obj: Record<string, number>): number => Object.values(obj).reduce((a, b) => a + b, 0);

describe('thresholds', () => {
  it('opportunity weights sum to 1.0', () => {
    expect(sum(OPPORTUNITY_WEIGHTS as unknown as Record<string, number>)).toBeCloseTo(1, 10);
  });

  it('smart-money weights sum to 1.0', () => {
    expect(sum(SMART_MONEY_WEIGHTS as unknown as Record<string, number>)).toBeCloseTo(1, 10);
  });

  it('signal bands fully cover 0..100 without gaps', () => {
    for (let s = 0; s <= 100; s++) {
      expect(signalLabel(s)).toBeTypeOf('string');
    }
    expect(signalLabel(90)).toBe('Strong accumulation');
    expect(signalLabel(70)).toBe('Positive accumulation');
    expect(signalLabel(55)).toBe('Mixed');
    expect(signalLabel(40)).toBe('Elevated selling');
    expect(signalLabel(10)).toBe('Strong distribution');
  });

  it('clamps out-of-range scores', () => {
    expect(signalLabel(-5)).toBe('Strong distribution');
    expect(signalLabel(200)).toBe('Strong accumulation');
  });

  it('signal bands are contiguous', () => {
    const sorted = [...SIGNAL_BANDS].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.min).toBe(sorted[i - 1]!.max + 1);
    }
  });

  it('price-source confidence is highest for stable pools and zero for unknown', () => {
    expect(PRICE_SOURCE_CONFIDENCE.STABLE_POOL).toBeGreaterThan(
      PRICE_SOURCE_CONFIDENCE.NATIVE_PAIR,
    );
    expect(PRICE_SOURCE_CONFIDENCE.UNKNOWN).toBe(0);
  });
});
