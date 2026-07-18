/**
 * Deterministic demo data for the stock-token index layer. Produces illustrative
 * tokenized-stock assets and curated index baskets, plus deterministic price
 * history so index NAV series can be charted.
 *
 * IMPORTANT: these are DEMO/illustrative assets. Tickers echo well-known
 * companies for realism, but the rows carry clearly-fake `0xDEMO…` addresses,
 * `isDemo: true`, and NO real Robinhood Chain / stock-token contract or
 * price-feed addresses are invented. Nothing here is investment advice or a
 * claim that these are real, tradeable, or backed assets.
 */

import { mulberry32, seedFromString, type Rng } from '../utils/prng.js';
import { demoAddress } from '../utils/hash.js';
import type { IndexMethodology } from '@chainscope/config';

export interface DemoStock {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  contractAddress: string;
  priceFeedAddress: string;
  decimals: number;
  priceUsd: number;
  priceConfidence: number;
  marketCapUsd: number;
  sharesOutstanding: string;
  dividendYield: number;
  volatility: number;
  assetClass: string;
  country: string;
  currency: string;
  riskRating: 'LOW' | 'MEDIUM' | 'HIGH';
  colorTheme: string;
  oracleStatus: 'OK';
}

export interface DemoIndexDef {
  slug: string;
  name: string;
  symbol: string;
  description: string;
  category: string;
  methodology: IndexMethodology;
  maxWeightBps: number;
  rebalanceSchedule: string;
  benchmark: string;
  tickers: string[];
}

export interface DemoStockPricePoint {
  ticker: string;
  takenAt: number; // epoch ms
  priceUsd: number;
}

interface StockSeed {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  basePrice: number;
  marketCapB: number; // billions
  dividendYield: number;
  volatility: number; // annualized fraction
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  color: string;
}

// Illustrative universe. Fundamentals are approximate/fictionalized for demo.
const UNIVERSE: StockSeed[] = [
  {
    ticker: 'AAPL',
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    basePrice: 225,
    marketCapB: 3400,
    dividendYield: 0.0044,
    volatility: 0.24,
    risk: 'LOW',
    color: '#a3aab3',
  },
  {
    ticker: 'MSFT',
    companyName: 'Microsoft Corp.',
    sector: 'Technology',
    industry: 'Software',
    basePrice: 430,
    marketCapB: 3200,
    dividendYield: 0.0072,
    volatility: 0.23,
    risk: 'LOW',
    color: '#5bb0a0',
  },
  {
    ticker: 'NVDA',
    companyName: 'NVIDIA Corp.',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 128,
    marketCapB: 3150,
    dividendYield: 0.0003,
    volatility: 0.48,
    risk: 'HIGH',
    color: '#76b900',
  },
  {
    ticker: 'GOOGL',
    companyName: 'Alphabet Inc.',
    sector: 'Communication Services',
    industry: 'Internet Content',
    basePrice: 178,
    marketCapB: 2200,
    dividendYield: 0.0045,
    volatility: 0.28,
    risk: 'MEDIUM',
    color: '#e5794f',
  },
  {
    ticker: 'AMZN',
    companyName: 'Amazon.com Inc.',
    sector: 'Consumer Discretionary',
    industry: 'Internet Retail',
    basePrice: 185,
    marketCapB: 1950,
    dividendYield: 0,
    volatility: 0.32,
    risk: 'MEDIUM',
    color: '#f0a640',
  },
  {
    ticker: 'META',
    companyName: 'Meta Platforms Inc.',
    sector: 'Communication Services',
    industry: 'Internet Content',
    basePrice: 560,
    marketCapB: 1420,
    dividendYield: 0.0035,
    volatility: 0.38,
    risk: 'MEDIUM',
    color: '#4a7cf0',
  },
  {
    ticker: 'TSLA',
    companyName: 'Tesla Inc.',
    sector: 'Consumer Discretionary',
    industry: 'Auto Manufacturers',
    basePrice: 240,
    marketCapB: 770,
    dividendYield: 0,
    volatility: 0.58,
    risk: 'HIGH',
    color: '#e23b3b',
  },
  {
    ticker: 'AMD',
    companyName: 'Advanced Micro Devices',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 160,
    marketCapB: 260,
    dividendYield: 0,
    volatility: 0.5,
    risk: 'HIGH',
    color: '#68b06e',
  },
  {
    ticker: 'AVGO',
    companyName: 'Broadcom Inc.',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 170,
    marketCapB: 790,
    dividendYield: 0.012,
    volatility: 0.36,
    risk: 'MEDIUM',
    color: '#d05b8c',
  },
  {
    ticker: 'TSM',
    companyName: 'Taiwan Semiconductor',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 190,
    marketCapB: 980,
    dividendYield: 0.011,
    volatility: 0.34,
    risk: 'MEDIUM',
    color: '#c14b4b',
  },
  {
    ticker: 'QCOM',
    companyName: 'Qualcomm Inc.',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 165,
    marketCapB: 185,
    dividendYield: 0.019,
    volatility: 0.35,
    risk: 'MEDIUM',
    color: '#5a7fd0',
  },
  {
    ticker: 'INTC',
    companyName: 'Intel Corp.',
    sector: 'Technology',
    industry: 'Semiconductors',
    basePrice: 22,
    marketCapB: 95,
    dividendYield: 0.015,
    volatility: 0.44,
    risk: 'HIGH',
    color: '#4b8fd0',
  },
  {
    ticker: 'PLTR',
    companyName: 'Palantir Technologies',
    sector: 'Technology',
    industry: 'Software',
    basePrice: 62,
    marketCapB: 140,
    dividendYield: 0,
    volatility: 0.62,
    risk: 'HIGH',
    color: '#111827',
  },
  {
    ticker: 'CRWD',
    companyName: 'CrowdStrike Holdings',
    sector: 'Technology',
    industry: 'Cybersecurity',
    basePrice: 320,
    marketCapB: 78,
    dividendYield: 0,
    volatility: 0.46,
    risk: 'HIGH',
    color: '#e01f3d',
  },
  {
    ticker: 'PANW',
    companyName: 'Palo Alto Networks',
    sector: 'Technology',
    industry: 'Cybersecurity',
    basePrice: 360,
    marketCapB: 116,
    dividendYield: 0,
    volatility: 0.4,
    risk: 'MEDIUM',
    color: '#f04e23',
  },
  {
    ticker: 'ZS',
    companyName: 'Zscaler Inc.',
    sector: 'Technology',
    industry: 'Cybersecurity',
    basePrice: 195,
    marketCapB: 30,
    dividendYield: 0,
    volatility: 0.5,
    risk: 'HIGH',
    color: '#3564c0',
  },
  {
    ticker: 'RIVN',
    companyName: 'Rivian Automotive',
    sector: 'Consumer Discretionary',
    industry: 'Auto Manufacturers',
    basePrice: 13,
    marketCapB: 13,
    dividendYield: 0,
    volatility: 0.7,
    risk: 'HIGH',
    color: '#f5c518',
  },
  {
    ticker: 'ENPH',
    companyName: 'Enphase Energy',
    sector: 'Energy',
    industry: 'Solar',
    basePrice: 95,
    marketCapB: 13,
    dividendYield: 0,
    volatility: 0.55,
    risk: 'HIGH',
    color: '#f26722',
  },
  {
    ticker: 'FSLR',
    companyName: 'First Solar Inc.',
    sector: 'Energy',
    industry: 'Solar',
    basePrice: 210,
    marketCapB: 22,
    dividendYield: 0,
    volatility: 0.48,
    risk: 'HIGH',
    color: '#2ba6de',
  },
  {
    ticker: 'JNJ',
    companyName: 'Johnson & Johnson',
    sector: 'Healthcare',
    industry: 'Pharmaceuticals',
    basePrice: 155,
    marketCapB: 375,
    dividendYield: 0.031,
    volatility: 0.18,
    risk: 'LOW',
    color: '#c8102e',
  },
  {
    ticker: 'LLY',
    companyName: 'Eli Lilly and Co.',
    sector: 'Healthcare',
    industry: 'Pharmaceuticals',
    basePrice: 790,
    marketCapB: 750,
    dividendYield: 0.0065,
    volatility: 0.3,
    risk: 'MEDIUM',
    color: '#d52b1e',
  },
  {
    ticker: 'KO',
    companyName: 'Coca-Cola Co.',
    sector: 'Consumer Staples',
    industry: 'Beverages',
    basePrice: 62,
    marketCapB: 268,
    dividendYield: 0.031,
    volatility: 0.16,
    risk: 'LOW',
    color: '#f40009',
  },
  {
    ticker: 'PG',
    companyName: 'Procter & Gamble',
    sector: 'Consumer Staples',
    industry: 'Household Products',
    basePrice: 168,
    marketCapB: 396,
    dividendYield: 0.024,
    volatility: 0.15,
    risk: 'LOW',
    color: '#0072ce',
  },
  {
    ticker: 'JPM',
    companyName: 'JPMorgan Chase & Co.',
    sector: 'Financials',
    industry: 'Banks',
    basePrice: 215,
    marketCapB: 610,
    dividendYield: 0.023,
    volatility: 0.26,
    risk: 'MEDIUM',
    color: '#5c2d2d',
  },
];

/** Curated demo indexes referencing the universe by ticker. */
const INDEX_DEFS: DemoIndexDef[] = [
  {
    slug: 'mag7',
    name: 'Magnificent 7',
    symbol: 'MAG7',
    category: 'Thematic',
    description: 'The seven mega-cap US technology and growth leaders.',
    methodology: 'CAP_CAPPED',
    maxWeightBps: 2500,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'QQQ',
    tickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'],
  },
  {
    slug: 'ai-index',
    name: 'AI & Compute Index',
    symbol: 'AIX',
    category: 'Thematic',
    description: 'Companies driving AI compute, models and infrastructure.',
    methodology: 'MARKET_CAP',
    maxWeightBps: 3000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'QQQ',
    tickers: ['NVDA', 'MSFT', 'GOOGL', 'META', 'AMD', 'AVGO', 'PLTR', 'TSM'],
  },
  {
    slug: 'semis',
    name: 'Semiconductors Index',
    symbol: 'SEMI',
    category: 'Sector',
    description: 'Leading semiconductor designers and foundries.',
    methodology: 'CAP_CAPPED',
    maxWeightBps: 2500,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'SMH',
    tickers: ['NVDA', 'AVGO', 'TSM', 'AMD', 'QCOM', 'INTC'],
  },
  {
    slug: 'cyber',
    name: 'Cybersecurity Index',
    symbol: 'CYBR',
    category: 'Sector',
    description: 'Pure-play cybersecurity platforms.',
    methodology: 'EQUAL',
    maxWeightBps: 10000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'CIBR',
    tickers: ['CRWD', 'PANW', 'ZS'],
  },
  {
    slug: 'clean-energy',
    name: 'Clean Energy Index',
    symbol: 'CLEAN',
    category: 'Thematic',
    description: 'Solar and electrification names.',
    methodology: 'INVERSE_VOL',
    maxWeightBps: 10000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'ICLN',
    tickers: ['ENPH', 'FSLR', 'TSLA', 'RIVN'],
  },
  {
    slug: 'ev',
    name: 'Electric Vehicles Index',
    symbol: 'EVX',
    category: 'Thematic',
    description: 'Electric-vehicle manufacturers.',
    methodology: 'EQUAL',
    maxWeightBps: 10000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'DRIV',
    tickers: ['TSLA', 'RIVN'],
  },
  {
    slug: 'dividend',
    name: 'Dividend Leaders Index',
    symbol: 'DIVL',
    category: 'Income',
    description: 'Large-cap, lower-volatility dividend payers.',
    methodology: 'INVERSE_VOL',
    maxWeightBps: 3000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'SCHD',
    tickers: ['JNJ', 'KO', 'PG', 'JPM'],
  },
  {
    slug: 'healthcare',
    name: 'Healthcare Index',
    symbol: 'HLTH',
    category: 'Sector',
    description: 'Pharmaceutical and healthcare leaders.',
    methodology: 'MARKET_CAP',
    maxWeightBps: 6000,
    rebalanceSchedule: 'QUARTERLY',
    benchmark: 'XLV',
    tickers: ['LLY', 'JNJ'],
  },
];

function jitter(rng: Rng, base: number, pct: number): number {
  return base * (1 + rng.float(-pct, pct));
}

/** Build the deterministic demo stock universe. */
export function generateDemoStocks(seed: number): DemoStock[] {
  const rng = mulberry32(seed ^ 0x57_0c_c5);
  return UNIVERSE.map((s) => {
    const price = Math.round(jitter(rng, s.basePrice, 0.05) * 100) / 100;
    const marketCapUsd = Math.round(jitter(rng, s.marketCapB, 0.03) * 1e9);
    const sharesOutstanding = BigInt(Math.round(marketCapUsd / price)).toString();
    return {
      ticker: s.ticker,
      companyName: s.companyName,
      sector: s.sector,
      industry: s.industry,
      description: `${s.companyName} — ${s.industry}. Illustrative demo asset; not a real tokenized security.`,
      contractAddress: demoAddress('stock', s.ticker.toLowerCase()),
      priceFeedAddress: demoAddress('feed', s.ticker.toLowerCase()),
      decimals: 18,
      priceUsd: price,
      priceConfidence: 92,
      marketCapUsd,
      sharesOutstanding,
      dividendYield: s.dividendYield,
      volatility: s.volatility,
      assetClass: 'EQUITY',
      country: 'US',
      currency: 'USD',
      riskRating: s.risk,
      colorTheme: s.color,
      oracleStatus: 'OK',
    };
  });
}

export function getDemoIndexDefs(): DemoIndexDef[] {
  return INDEX_DEFS.map((d) => ({ ...d, tickers: [...d.tickers] }));
}

/**
 * Deterministic daily price history for every stock over `days` trailing days
 * ending at `now`. A seeded geometric random walk with per-stock drift and the
 * stock's own volatility, so index NAV series look realistic and are stable for
 * a given (seed, now, days). The final point equals the stock's current price.
 */
export function generateDemoStockHistory(
  stocks: readonly DemoStock[],
  now: number,
  days = 120,
): DemoStockPricePoint[] {
  const points: DemoStockPricePoint[] = [];
  const dayMs = 86_400_000;
  for (const stock of stocks) {
    const rng = mulberry32(seedFromString(`hist:${stock.ticker}`));
    // Daily vol from annualized: σ_d = σ_a / √252.
    const dailyVol = stock.volatility / Math.sqrt(252);
    const drift = rng.float(-0.0003, 0.0006); // small deterministic per-name drift
    // Walk backward from the current price so the last point is exactly current.
    const levels: number[] = new Array(days + 1);
    levels[days] = stock.priceUsd;
    for (let i = days - 1; i >= 0; i--) {
      const shock = (rng.next() * 2 - 1) * dailyVol;
      const step = 1 + drift + shock;
      levels[i] = levels[i + 1]! / (step > 0.5 ? step : 0.5);
    }
    for (let i = 0; i <= days; i++) {
      points.push({
        ticker: stock.ticker,
        takenAt: now - (days - i) * dayMs,
        priceUsd: Math.round(levels[i]! * 100) / 100,
      });
    }
  }
  return points;
}
