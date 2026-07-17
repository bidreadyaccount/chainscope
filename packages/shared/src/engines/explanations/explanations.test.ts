import { describe, it, expect } from 'vitest';
import { generateExplanations } from './explanations.js';
import { formatUsd, formatPct } from './format.js';
import type { ExplanationInput } from './types.js';
import type { TokenMetrics } from '../metrics/types.js';
import type { ScoreResult } from '../scoring/types.js';

function metrics(overrides: Partial<TokenMetrics> = {}): TokenMetrics {
  return {
    window: '15m',
    windowStartMs: 0,
    windowEndMs: 900_000,
    buyVolumeUsd: 0,
    sellVolumeUsd: 0,
    netFlowUsd: 0,
    buys: 0,
    sells: 0,
    uniqueBuyers: 0,
    uniqueSellers: 0,
    buySellRatio: 0,
    whaleBuyVolumeUsd: 0,
    whaleSellVolumeUsd: 0,
    whaleNetFlowUsd: 0,
    smartMoneyBuyVolumeUsd: 0,
    smartMoneySellVolumeUsd: 0,
    smartMoneyNetFlowUsd: 0,
    retailNetFlowUsd: 0,
    newWalletNetFlowUsd: 0,
    botAssociatedVolumeUsd: 0,
    deployerLinkedNetFlowUsd: 0,
    marketMakerVolumeUsd: 0,
    protocolVolumeUsd: 0,
    avgTradeSizeUsd: 0,
    medianTradeSizeUsd: 0,
    priceChangePct: null,
    volumeAcceleration: null,
    liquidityChangePct: null,
    holderGrowth: null,
    buyerConcentration: 0,
    sellerConcentration: 0,
    walletQualityScore: 50,
    dataConfidenceScore: 90,
    uniqueBuyerGrowth: null,
    buyerQualityImprovement: null,
    tradeCount: 20,
    pricedTradeCount: 20,
    ...overrides,
  };
}

const emptyScore: ScoreResult = {
  score: 50,
  scorePreClamp: 50,
  baseScore: 50,
  signal: 'Mixed',
  components: [],
  penalties: [],
  totalPenalty: 0,
  riskScore: 0,
};

function input(m: Partial<TokenMetrics>, extra: Partial<ExplanationInput> = {}): ExplanationInput {
  return { metrics: metrics(m), score: emptyScore, ...extra };
}

describe('formatting helpers', () => {
  it('formats USD in $82,400 style', () => {
    expect(formatUsd(82_400)).toBe('$82,400');
    expect(formatUsd(-1_200)).toBe('-$1,200');
  });
  it('formats fractions as percentages', () => {
    expect(formatPct(0.63)).toBe('63%');
  });
});

describe('generateExplanations — positive factors (threshold-driven)', () => {
  it('smart-money net buying above threshold produces a factor with the real number', () => {
    const e = generateExplanations(
      input({ smartMoneyNetFlowUsd: 82_400 }, { window: '15m', counts: { smartMoneyBuyers: 4 } }),
    );
    expect(e.positiveFactors.some((f) => f.includes('$82,400'))).toBe(true);
    expect(e.positiveFactors.some((f) => f.includes('4 smart-money'))).toBe(true);
  });

  it('smart-money net flow just below threshold produces no factor', () => {
    const e = generateExplanations(input({ smartMoneyNetFlowUsd: 9_999 }));
    expect(e.positiveFactors.some((f) => f.toLowerCase().includes('smart-money'))).toBe(false);
  });

  it('whale accumulation above threshold is stated', () => {
    const e = generateExplanations(input({ whaleNetFlowUsd: 150_000 }));
    expect(e.positiveFactors.some((f) => f.includes('$150,000'))).toBe(true);
  });

  it('unique-buyer growth above 25% is stated with the count', () => {
    const e = generateExplanations(input({ uniqueBuyerGrowth: 0.4, uniqueBuyers: 35 }));
    expect(e.positiveFactors.some((f) => f.includes('40%') && f.includes('35'))).toBe(true);
  });

  it('strong buy/sell imbalance is stated', () => {
    const e = generateExplanations(input({ buyVolumeUsd: 90_000, sellVolumeUsd: 10_000 }));
    expect(e.positiveFactors.some((f) => f.includes('bought') && f.includes('sold'))).toBe(true);
  });

  it('significant liquidity growth is stated', () => {
    const e = generateExplanations(input({ liquidityChangePct: 0.3 }));
    expect(e.positiveFactors.some((f) => f.includes('Liquidity grew') && f.includes('30%'))).toBe(
      true,
    );
  });

  it('high wallet-quality mix is stated when no explicit improvement given', () => {
    const e = generateExplanations(input({ walletQualityScore: 82 }));
    expect(e.positiveFactors.some((f) => f.includes('82'))).toBe(true);
  });
});

describe('generateExplanations — risk factors (hedged)', () => {
  it('extreme buyer concentration produces the canonical top-5 sentence', () => {
    const e = generateExplanations(input({ buyerConcentration: 0.63 }));
    expect(e.riskFactors.some((f) => f.includes('top 5 buyers') && f.includes('63%'))).toBe(true);
  });

  it('concentration just below the extreme threshold produces nothing', () => {
    const e = generateExplanations(input({ buyerConcentration: 0.59 }));
    expect(e.riskFactors.some((f) => f.includes('account for'))).toBe(false);
  });

  it('deployer-linked selling is flagged with the amount', () => {
    const e = generateExplanations(
      input({ deployerLinkedNetFlowUsd: -42_000 }, { counts: { deployerSellers: 3 } }),
    );
    expect(e.riskFactors.some((f) => f.includes('sold') && f.includes('$42,000'))).toBe(true);
  });

  it('liquidity removal is flagged', () => {
    const e = generateExplanations(input({ liquidityChangePct: -0.35 }));
    expect(e.riskFactors.some((f) => f.includes('Liquidity fell') && f.includes('35%'))).toBe(true);
  });

  it('very low liquidity is flagged from the pool value', () => {
    const e = generateExplanations(input({}, { liquidityUsd: 8_000 }));
    expect(e.riskFactors.some((f) => f.includes('$8,000'))).toBe(true);
  });

  it('unreliable price is flagged', () => {
    const e = generateExplanations(input({}, { priceConfidence: 10 }));
    expect(e.riskFactors.some((f) => f.toLowerCase().includes('price confidence'))).toBe(true);
  });

  it('low data confidence is flagged', () => {
    const e = generateExplanations(input({ dataConfidenceScore: 15 }));
    expect(e.riskFactors.some((f) => f.includes('15 of 100'))).toBe(true);
  });

  it('bot-heavy volume produces a hedged automation note', () => {
    const e = generateExplanations(
      input({ buyVolumeUsd: 60_000, sellVolumeUsd: 40_000, botAssociatedVolumeUsd: 50_000 }),
    );
    expect(e.riskFactors.some((f) => f.startsWith('Possible automated activity'))).toBe(true);
  });
});

describe('generateExplanations — determinism and neutrality', () => {
  it('identical input yields identical output', () => {
    const a = generateExplanations(
      input({ smartMoneyNetFlowUsd: 50_000, buyerConcentration: 0.7 }),
    );
    const b = generateExplanations(
      input({ smartMoneyNetFlowUsd: 50_000, buyerConcentration: 0.7 }),
    );
    expect(a).toEqual(b);
  });

  it('a quiet, clean token yields no factors either way', () => {
    const e = generateExplanations(input({}));
    expect(e.positiveFactors).toHaveLength(0);
    expect(e.riskFactors).toHaveLength(0);
  });
});
