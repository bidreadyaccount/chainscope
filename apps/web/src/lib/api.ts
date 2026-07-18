/**
 * API client: typed fetch helpers against the ChainScope API (shapes captured
 * from the live Phase 3 server). All raw onchain amounts arrive as strings and
 * are NEVER parsed to floats for math — only pre-computed USD numbers from the
 * API are used numerically.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';

export type Window = '1m' | '5m' | '15m' | '1h' | '4h' | '24h';
export const WINDOWS: Window[] = ['1m', '5m', '15m', '1h', '4h', '24h'];

export interface TokenRow {
  rank: number | null;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  ageDays: number;
  priceUsd: number | null;
  priceConfidence: number;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  netFlowUsd: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  whaleNetFlowUsd: number;
  smartMoneyNetFlowUsd: number;
  retailNetFlowUsd: number;
  newWalletNetFlowUsd: number;
  deployerLinkedNetFlowUsd: number;
  volumeAcceleration: number | null;
  opportunityScore: number;
  riskScore: number;
  signal: string;
  dataConfidence: number;
}

export interface TokenDetail extends TokenRow {
  isVerified: boolean;
  liquidityChangePct: number | null;
  scenario?: string;
  pool?: { address: string; quoteSymbol: string; liquidityUsd: number | null };
  explorer: { token: string };
}

export interface ScoreComponent {
  key: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
}
export interface ScorePenalty {
  key: string;
  applied: number;
  maxPenalty: number;
  severity: number;
  evidence: string;
}
export interface TokenScore {
  address: string;
  window: Window;
  opportunityScore: number;
  riskScore: number;
  signal: string;
  baseScore: number;
  totalPenalty: number;
  components: ScoreComponent[];
  penalties: ScorePenalty[];
  explanations: { positiveFactors: string[]; riskFactors: string[] };
}

export interface Trade {
  id: string;
  chainId: number;
  transactionHash: string;
  logIndex: number;
  blockNumber: string;
  blockTimestamp: string;
  dexName: string;
  poolAddress: string;
  traderAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  quoteTokenSymbol: string;
  side: 'BUY' | 'SELL';
  tokenAmount: string;
  quoteAmount: string;
  priceUsd: number | null;
  valueUsd: number | null;
  priceConfidence: number;
  walletClass: string;
  isDemo: boolean;
}

export interface WalletLabel {
  class: string;
  confidence: number;
  reasons: string[];
  supportingMetrics: Record<string, unknown>;
  lastCalculatedAt: string;
}
export interface BotIndicator {
  key: string;
  triggered: boolean;
  weight: number;
  detail: string;
}
export interface WalletDetail {
  address: string;
  primaryClass: string;
  classificationConfidence: number;
  labels: WalletLabel[];
  portfolioEstimateUsd: number | null;
  trackedCurrentValueUsd: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  winRate: number;
  closedPositions: number;
  winningPositions: number;
  losingPositions: number;
  avgTradeSizeUsd: number | null;
  tradeCount: number;
  firstSeenAt: string | null;
  botProbability: number;
  botIndicators: BotIndicator[];
  smartMoney: { score: number; status: string; sampleSizeMet: boolean; winRate: number };
  deployerRelationships: Array<{ tokenAddress?: string; kind?: string; evidence?: string }>;
  fundingSourceAddress: string | null;
  fundingSourcePeerCount: number;
  explorer: { address: string };
}

export interface WalletPosition {
  tokenAddress: string;
  tokenSymbol: string;
  currentQty: number;
  currentValueUsd: number | null;
  avgEntryCostUsd: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalReturnUsd: number;
  winningClosed: number;
  losingClosed: number;
  isComplete: boolean;
  firstEntryAt: string | null;
  lastTradeAt: string | null;
}

export interface ApiStatus {
  mode: 'demo' | 'live';
  chain: { id: number; name: string; verified: boolean };
  uptimeSeconds: number;
  datastores: {
    database: { status: string; latencyMs: number | null };
    redis: { status: string; latencyMs: number | null };
  };
  rpc: { configured: boolean; connected: boolean; websocketConfigured: boolean };
  indexer: {
    lastIndexedBlock: string;
    headBlock: string | null;
    lagBlocks: string | null;
    confirmations: number;
    running: boolean;
  };
  demoStream: {
    running: boolean;
    ingested: number;
    lastTradeAt: number | null;
    intervalMs: number;
  } | null;
  adapters: Array<{ name: string; protocol: string; enabled: boolean; isDemo: boolean }>;
  coverage: { tokens: number; trades: number; wallets: number; positions: number };
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `API ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  tokens: (window: Window, search?: string) =>
    get<Paginated<TokenRow> & { window: Window }>(
      `/api/v1/tokens?window=${window}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    ),
  token: (address: string) => get<TokenDetail>(`/api/v1/tokens/${address}`),
  tokenScore: (address: string, window: Window) =>
    get<TokenScore>(`/api/v1/tokens/${address}/score?window=${window}`),
  tokenTrades: (address: string, limit = 25) =>
    get<Paginated<Trade>>(`/api/v1/tokens/${address}/trades?limit=${limit}`),
  liveTrades: (limit = 50) => get<Paginated<Trade>>(`/api/v1/trades/live?limit=${limit}`),
  wallet: (address: string) => get<WalletDetail>(`/api/v1/wallets/${address}`),
  walletTrades: (address: string, limit = 25) =>
    get<Paginated<Trade>>(`/api/v1/wallets/${address}/trades?limit=${limit}`),
  walletPositions: (address: string) =>
    get<Paginated<WalletPosition>>(`/api/v1/wallets/${address}/positions`),
  status: () => get<ApiStatus>(`/api/v1/status`),
  methodology: () => get<Record<string, unknown>>(`/api/v1/methodology`),
  indexes: () => get<Paginated<IndexListItem>>(`/api/v1/indexes`),
  index: (slug: string) => get<IndexDetail>(`/api/v1/indexes/${slug}`),
  stocks: (sector?: string) =>
    get<Paginated<StockRow>>(
      `/api/v1/stocks${sector ? `?sector=${encodeURIComponent(sector)}` : ''}`,
    ),
  stock: (ticker: string) => get<StockDetail>(`/api/v1/stocks/${ticker}`),
};

export interface IndexListItem {
  slug: string;
  name: string;
  symbol: string;
  category: string | null;
  methodology: string;
  constituentCount: number;
  latestLevel: number | null;
  baseValue: number;
  return30d: number | null;
  returnYtd: number | null;
  annualizedVolatility: number | null;
  benchmark: string | null;
  isDemo: boolean;
}

export interface IndexConstituentView {
  ticker: string;
  companyName: string;
  sector: string;
  weightBps: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  dividendYield: number | null;
  colorTheme: string | null;
  riskRating: string | null;
}

export interface IndexDetail {
  slug: string;
  name: string;
  symbol: string;
  description: string | null;
  category: string | null;
  methodology: string;
  maxWeightBps: number;
  rebalanceSchedule: string;
  benchmark: string | null;
  baseValue: number;
  isDemo: boolean;
  performance: {
    returns: Record<string, number | null>;
    annualizedVolatility: number | null;
    maxDrawdown: number | null;
    latestLevel: number | null;
    firstLevel: number | null;
  };
  concentration: { top1Bps: number; top5Bps: number; hhi: number; effectiveN: number };
  sectorAllocation: Array<{ sector: string; weightBps: number }>;
  constituents: IndexConstituentView[];
  navHistory: Array<{ takenAt: string; level: number }>;
}

export interface StockRow {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string | null;
  priceUsd: number | null;
  priceConfidence: number;
  marketCapUsd: number | null;
  dividendYield: number | null;
  volatility: number | null;
  riskRating: string | null;
  colorTheme: string | null;
  oracleStatus: string;
  isDemo: boolean;
}

export interface StockDetail extends StockRow {
  description: string | null;
  contractAddress: string | null;
  priceFeedAddress: string | null;
  decimals: number;
  sharesOutstanding: string | null;
  assetClass: string;
  country: string;
  currency: string;
  tradingEnabled: boolean;
  explorer: { token: string | null };
  memberOfIndexes: Array<{ slug: string; name: string; symbol: string; weightBps: number }>;
}
