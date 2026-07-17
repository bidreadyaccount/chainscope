import { describe, it, expect } from 'vitest';
import { OPPORTUNITY_WEIGHTS, RISK_PENALTIES, signalLabel } from '@chainscope/config';
import { computeOpportunityScore } from './opportunity.js';
import type { OpportunityInput, OpportunityComponents, RiskInputs } from './types.js';

function neutralComponents(overrides: Partial<OpportunityComponents> = {}): OpportunityComponents {
  return {
    smartMoneyNetFlowUsd: 0,
    whaleNetFlowUsd: 0,
    uniqueBuyerGrowth: 0,
    buySellImbalance: 0,
    liquidityGrowthPct: 0,
    buyerQualityImprovement: 0,
    volumeAcceleration: 0,
    priceConfirmation: 0,
    ...overrides,
  };
}

function cleanRisk(overrides: Partial<RiskInputs> = {}): RiskInputs {
  return {
    deployerLinkedNetFlowUsd: 0,
    liquidityChangePct: 0,
    buyerConcentration: 0,
    sellerConcentration: 0,
    priceConfidence: 90,
    dataConfidenceScore: 90,
    ...overrides,
  };
}

function inp(c: Partial<OpportunityComponents>, r: Partial<RiskInputs> = {}): OpportunityInput {
  return { components: neutralComponents(c), risk: cleanRisk(r) };
}

describe('computeOpportunityScore — weights and neutral baseline', () => {
  it('opportunity weights sum to 1.0', () => {
    const sum = Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('all-neutral components (every normalized = 0.5) → base score 50', () => {
    const r = computeOpportunityScore(inp({}));
    expect(r.baseScore).toBeCloseTo(50, 6);
    expect(r.score).toBeCloseTo(50, 6);
    expect(r.totalPenalty).toBe(0);
  });

  it('component weights match the config exactly', () => {
    const r = computeOpportunityScore(inp({}));
    const byKey = Object.fromEntries(r.components.map((c) => [c.key, c.weight]));
    expect(byKey.smartMoneyNetFlow).toBe(0.25);
    expect(byKey.whaleNetFlow).toBe(0.2);
    expect(byKey.uniqueBuyerGrowth).toBe(0.15);
    expect(byKey.buySellImbalance).toBe(0.1);
    expect(byKey.liquidityGrowth).toBe(0.1);
    expect(byKey.buyerQualityImprovement).toBe(0.1);
    expect(byKey.volumeAcceleration).toBe(0.05);
    expect(byKey.priceConfirmation).toBe(0.05);
  });
});

describe('computeOpportunityScore — breakdown consistency (identity)', () => {
  it('sum of component contributions === baseScore', () => {
    const r = computeOpportunityScore(
      inp({
        smartMoneyNetFlowUsd: 120_000,
        whaleNetFlowUsd: 80_000,
        uniqueBuyerGrowth: 0.6,
        buySellImbalance: 0.5,
        liquidityGrowthPct: 0.2,
        buyerQualityImprovement: 15,
        volumeAcceleration: 1.5,
        priceConfirmation: 0.1,
      }),
    );
    const sum = r.components.reduce((a, c) => a + c.contribution, 0);
    expect(sum).toBeCloseTo(r.baseScore, 6);
  });

  it('baseScore - totalPenalty === scorePreClamp', () => {
    const r = computeOpportunityScore(
      inp({ smartMoneyNetFlowUsd: 100_000 }, { liquidityChangePct: -0.5, priceConfidence: 10 }),
    );
    expect(r.baseScore - r.totalPenalty).toBeCloseTo(r.scorePreClamp, 6);
  });

  it('each component contribution = normalized * weight * 100', () => {
    const r = computeOpportunityScore(inp({ whaleNetFlowUsd: 50_000 }));
    for (const c of r.components) {
      // normalized is stored rounded to 4dp, so recomputing is approximate.
      expect(c.contribution).toBeCloseTo(c.normalized * c.weight * 100, 1);
    }
  });

  it('every normalized value is within [0,1]', () => {
    const r = computeOpportunityScore(
      inp({ smartMoneyNetFlowUsd: -500_000, whaleNetFlowUsd: 999_999, buySellImbalance: -3 }),
    );
    for (const c of r.components) {
      expect(c.normalized).toBeGreaterThanOrEqual(0);
      expect(c.normalized).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeOpportunityScore — normalization behaviour', () => {
  it('strong net buying pushes the score above neutral', () => {
    const r = computeOpportunityScore(inp({ smartMoneyNetFlowUsd: 300_000, whaleNetFlowUsd: 300_000 }));
    expect(r.score).toBeGreaterThan(50);
  });

  it('strong net selling pushes the score below neutral', () => {
    const r = computeOpportunityScore(inp({ smartMoneyNetFlowUsd: -300_000, whaleNetFlowUsd: -300_000 }));
    expect(r.score).toBeLessThan(50);
  });

  it('buy/sell imbalance maps linearly: +1 → 1.0, -1 → 0.0', () => {
    const up = computeOpportunityScore(inp({ buySellImbalance: 1 }));
    const down = computeOpportunityScore(inp({ buySellImbalance: -1 }));
    expect(up.components.find((c) => c.key === 'buySellImbalance')!.normalized).toBeCloseTo(1, 6);
    expect(down.components.find((c) => c.key === 'buySellImbalance')!.normalized).toBeCloseTo(0, 6);
  });
});

describe('computeOpportunityScore — clamping', () => {
  it('score never exceeds 100', () => {
    const r = computeOpportunityScore(
      inp({
        smartMoneyNetFlowUsd: 1e9,
        whaleNetFlowUsd: 1e9,
        uniqueBuyerGrowth: 100,
        buySellImbalance: 1,
        liquidityGrowthPct: 100,
        buyerQualityImprovement: 1000,
        volumeAcceleration: 100,
        priceConfirmation: 100,
      }),
    );
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('score never drops below 0 even with heavy penalties', () => {
    const r = computeOpportunityScore(
      inp(
        { smartMoneyNetFlowUsd: -1e9 },
        {
          deployerLinkedNetFlowUsd: -1e6,
          liquidityChangePct: -0.9,
          buyerConcentration: 0.99,
          washTradingScore: 1,
          relatedWalletConcentration: 0.99,
          liquidityUsd: 100,
          contractVerified: false,
          abnormalTransferRestrictions: true,
          priceConfidence: 0,
          dataConfidenceScore: 0,
        },
      ),
    );
    expect(r.score).toBe(0);
    expect(r.scorePreClamp).toBeLessThan(0);
  });
});

describe('computeOpportunityScore — every risk penalty triggers', () => {
  const cases: Array<[string, Partial<RiskInputs>]> = [
    ['deployerLinkedSelling', { deployerLinkedNetFlowUsd: -50_000 }],
    ['liquidityRemoval', { liquidityChangePct: -0.5 }],
    ['extremeHolderConcentration', { buyerConcentration: 0.8 }],
    ['washTradingLikelihood', { washTradingScore: 0.7 }],
    ['relatedWalletConcentration', { relatedWalletConcentration: 0.6 }],
    ['veryLowLiquidity', { liquidityUsd: 5_000 }],
    ['unverifiedContract', { contractVerified: false }],
    ['abnormalTransferRestrictions', { abnormalTransferRestrictions: true }],
    ['unreliablePrice', { priceConfidence: 5 }],
    ['insufficientHistory', { dataConfidenceScore: 10 }],
  ];

  for (const [key, risk] of cases) {
    it(`penalty '${key}' is applied when its trigger is met`, () => {
      const r = computeOpportunityScore(inp({}, risk));
      const p = r.penalties.find((x) => x.key === key);
      expect(p, `expected penalty ${key}`).toBeDefined();
      expect(p!.applied).toBeGreaterThan(0);
      expect(p!.maxPenalty).toBe(RISK_PENALTIES[key as keyof typeof RISK_PENALTIES]);
      expect(p!.evidence.length).toBeGreaterThan(0);
    });
  }

  it('no penalties fire on clean risk inputs', () => {
    const r = computeOpportunityScore(inp({}));
    expect(r.penalties).toHaveLength(0);
    expect(r.riskScore).toBe(0);
  });

  it('applied penalty never exceeds its configured maximum', () => {
    for (const [, risk] of cases) {
      const r = computeOpportunityScore(inp({}, risk));
      for (const p of r.penalties) expect(p.applied).toBeLessThanOrEqual(p.maxPenalty);
    }
  });

  it('risk score equals clamped total penalty', () => {
    const r = computeOpportunityScore(inp({}, { liquidityChangePct: -0.5, priceConfidence: 5 }));
    expect(r.riskScore).toBeCloseTo(Math.min(100, r.totalPenalty), 6);
  });
});

describe('computeOpportunityScore — signal label boundaries (79.99 vs 80)', () => {
  it('signalLabel(80) → Strong accumulation', () => {
    expect(signalLabel(80)).toBe('Strong accumulation');
  });
  it('signalLabel(79.99) → Positive accumulation (no fractional gap)', () => {
    expect(signalLabel(79.99)).toBe('Positive accumulation');
  });
  it('signalLabel(65) → Positive; 64.99 → Mixed', () => {
    expect(signalLabel(65)).toBe('Positive accumulation');
    expect(signalLabel(64.99)).toBe('Mixed');
  });
  it('signalLabel(50) → Mixed; 49.99 → Elevated selling', () => {
    expect(signalLabel(50)).toBe('Mixed');
    expect(signalLabel(49.99)).toBe('Elevated selling');
  });
  it('signalLabel(35) → Elevated; 34.99 → Strong distribution', () => {
    expect(signalLabel(35)).toBe('Elevated selling');
    expect(signalLabel(34.99)).toBe('Strong distribution');
  });
  it('score result signal matches signalLabel(score)', () => {
    const r = computeOpportunityScore(inp({ smartMoneyNetFlowUsd: 200_000, whaleNetFlowUsd: 200_000 }));
    expect(r.signal).toBe(signalLabel(r.score));
  });
});
