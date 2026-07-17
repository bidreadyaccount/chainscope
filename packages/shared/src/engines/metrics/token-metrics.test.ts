import { describe, it, expect } from 'vitest';
import { computeTokenMetrics } from './token-metrics.js';
import type { MetricTrade, TokenMetricsInput } from './types.js';
import type { WalletClass } from '../../types/wallet.js';

const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);

function tr(
  side: 'BUY' | 'SELL',
  valueUsd: number | null,
  walletClass: WalletClass,
  traderAddress: string,
  priceConfidence = 90,
): MetricTrade {
  return { side, valueUsd, walletClass, traderAddress, priceConfidence, timestamp: T0 };
}

function input(trades: MetricTrade[], overrides: Partial<TokenMetricsInput> = {}): TokenMetricsInput {
  return {
    window: '1h',
    windowStartMs: T0,
    windowEndMs: T0 + 3_600_000,
    trades,
    ...overrides,
  };
}

describe('computeTokenMetrics — volumes, counts, ratios', () => {
  const trades = [
    tr('BUY', 1_000, 'RETAIL', '0x1'),
    tr('BUY', 3_000, 'WHALE', '0x2'),
    tr('SELL', 500, 'RETAIL', '0x3'),
    tr('SELL', 1_500, 'SMART_MONEY', '0x4'),
  ];
  const m = computeTokenMetrics(input(trades));

  it('buy/sell volumes and net flow', () => {
    expect(m.buyVolumeUsd).toBe(4_000);
    expect(m.sellVolumeUsd).toBe(2_000);
    expect(m.netFlowUsd).toBe(2_000); // 4000 - 2000
  });

  it('buy/sell counts and unique participants', () => {
    expect(m.buys).toBe(2);
    expect(m.sells).toBe(2);
    expect(m.uniqueBuyers).toBe(2);
    expect(m.uniqueSellers).toBe(2);
    expect(m.buySellRatio).toBe(1);
  });

  it('average and median trade sizes are numerically correct', () => {
    // sizes [1000, 3000, 500, 1500] → mean 1500, median (1000+1500)/2 = 1250.
    expect(m.avgTradeSizeUsd).toBe(1_500);
    expect(m.medianTradeSizeUsd).toBe(1_250);
  });
});

describe('computeTokenMetrics — median with odd count', () => {
  it('odd-length median is the middle value', () => {
    const m = computeTokenMetrics(
      input([
        tr('BUY', 100, 'RETAIL', '0x1'),
        tr('BUY', 900, 'RETAIL', '0x2'),
        tr('BUY', 500, 'RETAIL', '0x3'),
      ]),
    );
    expect(m.medianTradeSizeUsd).toBe(500);
  });
});

describe('computeTokenMetrics — class-partitioned flows', () => {
  const trades = [
    tr('BUY', 30_000, 'WHALE', '0xw1'),
    tr('BUY', 50_000, 'MEGA_WHALE', '0xw2'),
    tr('SELL', 20_000, 'WHALE', '0xw3'),
    tr('BUY', 10_000, 'SMART_MONEY', '0xs1'),
    tr('SELL', 4_000, 'SMART_MONEY', '0xs2'),
    tr('BUY', 1_000, 'RETAIL', '0xr1'),
    tr('SELL', 3_000, 'RETAIL', '0xr2'),
    tr('BUY', 800, 'NEW_WALLET', '0xn1'),
    tr('SELL', 6_000, 'DEPLOYER_LINKED', '0xd1'),
    tr('BUY', 2_000, 'BOT', '0xb1'),
    tr('SELL', 2_000, 'BOT', '0xb1'),
  ];
  const m = computeTokenMetrics(input(trades));

  it('whale net flow = (30k + 50k buys) - 20k sell = 60k', () => {
    expect(m.whaleBuyVolumeUsd).toBe(80_000);
    expect(m.whaleSellVolumeUsd).toBe(20_000);
    expect(m.whaleNetFlowUsd).toBe(60_000);
  });

  it('smart-money net flow = 10k - 4k = 6k', () => {
    expect(m.smartMoneyNetFlowUsd).toBe(6_000);
  });

  it('retail net flow = 1k buy - 3k sell = -2k', () => {
    expect(m.retailNetFlowUsd).toBe(-2_000);
  });

  it('new-wallet net flow = +800', () => {
    expect(m.newWalletNetFlowUsd).toBe(800);
  });

  it('deployer-linked net flow = -6k (selling)', () => {
    expect(m.deployerLinkedNetFlowUsd).toBe(-6_000);
  });

  it('bot-associated volume = 2k + 2k = 4k', () => {
    expect(m.botAssociatedVolumeUsd).toBe(4_000);
  });
});

describe('computeTokenMetrics — market-maker / protocol exclusion (SPEC §8/§10)', () => {
  const trades = [
    tr('BUY', 10_000, 'RETAIL', '0xr1'),
    tr('BUY', 40_000, 'MARKET_MAKER', '0xmm'),
    tr('SELL', 30_000, 'MARKET_MAKER', '0xmm'),
    tr('BUY', 5_000, 'PROTOCOL', '0xp'),
  ];

  it('net flow excludes MM and protocol by default', () => {
    const m = computeTokenMetrics(input(trades));
    // Only retail +10k counts toward conviction net flow.
    expect(m.netFlowUsd).toBe(10_000);
    // But raw volumes still include everything.
    expect(m.buyVolumeUsd).toBe(55_000);
    expect(m.sellVolumeUsd).toBe(30_000);
    expect(m.marketMakerVolumeUsd).toBe(70_000);
    expect(m.protocolVolumeUsd).toBe(5_000);
  });

  it('option flags re-include MM and protocol flow', () => {
    const m = computeTokenMetrics(
      input(trades, { options: { includeMarketMakerFlow: true, includeProtocolFlow: true } }),
    );
    // 10k retail + (40k - 30k) MM + 5k protocol = 25k.
    expect(m.netFlowUsd).toBe(25_000);
  });

  it('including only MM leaves protocol excluded', () => {
    const m = computeTokenMetrics(input(trades, { options: { includeMarketMakerFlow: true } }));
    expect(m.netFlowUsd).toBe(20_000); // 10k + 10k MM, protocol still out
  });
});

describe('computeTokenMetrics — concentration', () => {
  it('top-5 buyer concentration = share of buy volume', () => {
    // One buyer dominates: 9000 of 10000 total buy volume.
    const trades = [
      tr('BUY', 9_000, 'WHALE', '0xbig'),
      tr('BUY', 250, 'RETAIL', '0xa'),
      tr('BUY', 250, 'RETAIL', '0xb'),
      tr('BUY', 250, 'RETAIL', '0xc'),
      tr('BUY', 250, 'RETAIL', '0xd'),
    ];
    const m = computeTokenMetrics(input(trades));
    // top-5 of 5 buyers = 100%.
    expect(m.buyerConcentration).toBe(1);
  });

  it('concentration among many small buyers is below 1', () => {
    const trades = Array.from({ length: 20 }, (_, i) => tr('BUY', 100, 'RETAIL', `0x${i}`));
    const m = computeTokenMetrics(input(trades));
    // top-5 of 20 equal buyers = 5/20 = 0.25.
    expect(m.buyerConcentration).toBeCloseTo(0.25, 4);
  });
});

describe('computeTokenMetrics — quality, confidence, deltas', () => {
  it('wallet-quality score is volume-weighted by class', () => {
    // 100% smart-money volume → quality 100.
    const smOnly = computeTokenMetrics(input([tr('BUY', 1_000, 'SMART_MONEY', '0xs')]));
    expect(smOnly.walletQualityScore).toBe(100);
    // 100% bot volume → 15.
    const botOnly = computeTokenMetrics(input([tr('BUY', 1_000, 'BOT', '0xb')]));
    expect(botOnly.walletQualityScore).toBe(15);
  });

  it('data confidence blends price coverage and sample size', () => {
    // 10 trades all at confidence 90 → coverage 90; sample adequacy 1.
    const trades = Array.from({ length: 10 }, (_, i) => tr('BUY', 100, 'RETAIL', `0x${i}`, 90));
    const m = computeTokenMetrics(input(trades));
    // 0.6*90 + 0.4*100 = 94.
    expect(m.dataConfidenceScore).toBeCloseTo(94, 4);
  });

  it('unpriced trades count but contribute 0 USD; priced count tracked', () => {
    const m = computeTokenMetrics(
      input([tr('BUY', null, 'RETAIL', '0x1', 0), tr('BUY', 1_000, 'RETAIL', '0x2', 90)]),
    );
    expect(m.tradeCount).toBe(2);
    expect(m.pricedTradeCount).toBe(1);
    expect(m.buyVolumeUsd).toBe(1_000);
    expect(m.medianTradeSizeUsd).toBe(1_000); // only priced sizes
  });

  it('unique-buyer growth and price/liquidity change vs prior reference', () => {
    const m = computeTokenMetrics(
      input([tr('BUY', 100, 'RETAIL', '0x1'), tr('BUY', 100, 'RETAIL', '0x2'), tr('BUY', 100, 'RETAIL', '0x3')], {
        prior: { uniqueBuyers: 2, priceUsd: 1, liquidityUsd: 100_000, walletQualityScore: 40 },
        currentPriceUsd: 1.2,
        currentLiquidityUsd: 120_000,
      }),
    );
    expect(m.uniqueBuyerGrowth).toBeCloseTo(0.5, 4); // 3 vs 2 = +50%
    expect(m.priceChangePct).toBeCloseTo(0.2, 4);
    expect(m.liquidityChangePct).toBeCloseTo(0.2, 4);
    expect(m.buyerQualityImprovement).toBeCloseTo(m.walletQualityScore - 40, 2);
  });

  it('volume acceleration compares window volume to baseline', () => {
    const m = computeTokenMetrics(
      input([tr('BUY', 1_500, 'RETAIL', '0x1')], { baselineVolumeUsd: 1_000 }),
    );
    expect(m.volumeAcceleration).toBeCloseTo(0.5, 4); // (1500-1000)/1000
  });

  it('holder growth is null when counts are unavailable', () => {
    const m = computeTokenMetrics(input([tr('BUY', 100, 'RETAIL', '0x1')]));
    expect(m.holderGrowth).toBeNull();
  });
});

describe('computeTokenMetrics — empty window', () => {
  it('yields zeroed metrics without throwing', () => {
    const m = computeTokenMetrics(input([]));
    expect(m.buyVolumeUsd).toBe(0);
    expect(m.netFlowUsd).toBe(0);
    expect(m.buySellRatio).toBe(0);
    expect(m.walletQualityScore).toBe(0);
    expect(m.medianTradeSizeUsd).toBe(0);
  });
});
