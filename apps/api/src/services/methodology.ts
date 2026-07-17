/**
 * Methodology — a single structured JSON source describing every wallet label,
 * token metric, score formula, risk penalty and known limitation (SPEC §14H,
 * §16). The web app renders this verbatim; it is generated from the same config
 * thresholds/weights the engines use so it can never drift from behaviour.
 */

import {
  OPPORTUNITY_WEIGHTS,
  RISK_PENALTIES,
  SIGNAL_BANDS,
  WALLET_THRESHOLDS,
  SMART_MONEY_WEIGHTS,
  SMART_MONEY_MIN_SAMPLE_SIZE,
  TIME_WINDOWS,
  TIME_WINDOW_LABEL,
} from '@chainscope/config';

export function buildMethodology(): Record<string, unknown> {
  return {
    version: 1,
    overview:
      'ChainScope classifies wallets behind DEX swaps, aggregates their behaviour per token over rolling windows, and ranks tokens with an explainable 0-100 Opportunity Score and a separate Risk Score. Read-only analytics — not financial advice. All explanations are generated deterministically from computed metrics, never by an LLM.',
    timeWindows: TIME_WINDOWS.map((w) => ({ key: w, label: TIME_WINDOW_LABEL[w] })),
    walletClasses: [
      {
        class: 'MEGA_WHALE',
        label: 'Mega whale',
        description:
          "Very large holder/trader. Any of: portfolio >= $1,000,000; a single trade >= $100,000; or control of >= 2% of a token's tracked circulating supply.",
      },
      {
        class: 'WHALE',
        label: 'Whale',
        description:
          'Large holder/trader. Any of: portfolio >= $250,000; single trade >= $25,000; or >= 1% of tracked circulating supply.',
      },
      {
        class: 'LARGE_TRADER',
        label: 'Large trader',
        description: 'Typical trade >= $5,000 or portfolio >= $50,000.',
      },
      {
        class: 'SMART_MONEY',
        label: 'Smart money',
        description:
          'Historically profitable wallet meeting the minimum sample size. Scored from realized profitability, win rate, entry timing, consistency, trade-count confidence and risk-adjusted return. Status tiers: Candidate, Emerging, Confirmed.',
      },
      {
        class: 'RETAIL',
        label: 'Retail',
        description:
          'Portfolio < $10,000 and typical trade < $1,000 with no stronger classification.',
      },
      {
        class: 'NEW_WALLET',
        label: 'New wallet',
        description:
          'First observed within the previous 7 days, or fewer than 5 lifetime observed transactions.',
      },
      {
        class: 'BOT',
        label: 'Possible bot',
        description:
          'Automated-behaviour indicators: launch-block purchase, extremely short reaction time, repeated identical amounts, abnormally high trade frequency, repetitive router/token patterns, very short holding periods. Probability is explainable per indicator.',
      },
      {
        class: 'DEPLOYER_LINKED',
        label: 'Deployer-linked',
        description:
          'Evidence of a relationship to the token deployer: direct funding, early allocation, shared funding source, interaction before public trading, or liquidity-management relationship. Shown with evidence and confidence — never presented as an accusation.',
      },
      {
        class: 'MARKET_MAKER',
        label: 'Market maker',
        description:
          'Identified market-making flow. Excluded from directional conviction metrics by default.',
      },
      {
        class: 'PROTOCOL',
        label: 'Protocol',
        description: 'Known protocol/contract flow. Excluded from conviction metrics by default.',
      },
      { class: 'UNKNOWN', label: 'Unknown', description: 'Insufficient history to classify.' },
    ],
    walletThresholds: WALLET_THRESHOLDS,
    smartMoney: { weights: SMART_MONEY_WEIGHTS, minSampleSize: SMART_MONEY_MIN_SAMPLE_SIZE },
    tokenMetrics: [
      { key: 'buyVolumeUsd', description: 'Total USD value of buys in the window.' },
      { key: 'sellVolumeUsd', description: 'Total USD value of sells in the window.' },
      {
        key: 'netFlowUsd',
        description:
          'Directional net flow (buys - sells). Excludes market-maker and protocol flow by default.',
      },
      { key: 'uniqueBuyers / uniqueSellers', description: 'Distinct buyer/seller wallet counts.' },
      { key: 'buySellRatio', description: 'Buy volume divided by sell volume.' },
      { key: 'whaleNetFlowUsd', description: 'Net flow from whale-tier wallets.' },
      { key: 'smartMoneyNetFlowUsd', description: 'Net flow from smart-money wallets.' },
      { key: 'retailNetFlowUsd', description: 'Net flow from retail wallets.' },
      { key: 'newWalletNetFlowUsd', description: 'Net flow from newly observed wallets.' },
      {
        key: 'deployerLinkedNetFlowUsd',
        description: 'Net flow from deployer-linked wallets (negative = deployer selling).',
      },
      {
        key: 'botAssociatedVolumeUsd',
        description: 'Volume associated with possible-bot wallets.',
      },
      {
        key: 'buyerConcentration / sellerConcentration',
        description: 'Top-N wallet share of buy/sell volume (0-1).',
      },
      {
        key: 'walletQualityScore',
        description: 'Quality-weighted composite of participating wallet classes.',
      },
      {
        key: 'dataConfidenceScore',
        description: 'Confidence in the metrics given price coverage and sample size.',
      },
      {
        key: 'volumeAcceleration',
        description: 'Change in volume versus a comparable baseline (null when no baseline).',
      },
    ],
    opportunityScore: {
      description:
        'Explainable 0-100 score. Each component is normalized to [0,1] deterministically (bounded tanh for signed magnitudes, linear for bounded [-1,1] inputs), weighted, summed to a 0-100 base, then reduced by triggered risk penalties and clamped to [0,100].',
      weights: OPPORTUNITY_WEIGHTS,
      signalBands: SIGNAL_BANDS,
    },
    riskScore: {
      description: 'Separate 0-100 score equal to the total triggered penalty magnitude.',
      penalties: RISK_PENALTIES,
      penaltyTriggers: [
        'deployer-linked selling',
        'liquidity removal',
        'extreme holder concentration',
        'wash-trading likelihood',
        'related-wallet concentration',
        'very low liquidity',
        'unverified token contract',
        'abnormal transfer restrictions',
        'unreliable price',
        'insufficient historical data',
      ],
    },
    rankings: {
      description: 'Twelve live rankings backed by Redis sorted sets, selectable by time window.',
      categories: [
        'opportunity',
        'smart_money_buying',
        'whale_accumulation',
        'whale_selling',
        'retail_momentum',
        'new_wallet_surge',
        'unusual_volume',
        'liquidity_growth',
        'deployer_selling',
        'coordinated_wallets',
        'strongest_distribution',
        'highest_risk',
      ],
    },
    limitations: [
      'Robinhood Chain network parameters and DEX addresses are unverified at build time; the app runs in deterministic demo mode until verified addresses are supplied.',
      'USD prices are shown only when confidence is adequate; otherwise "Insufficient pricing data" is displayed rather than a fabricated price.',
      'Wallet labels are hedged and evidence-based; relationships are never presented as accusations of illegal activity.',
      'Prior-window growth metrics are best-effort over the seeded 24h history.',
    ],
  };
}
