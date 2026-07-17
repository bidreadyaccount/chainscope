import type { Hex } from '../types/common.js';
import type { WalletClass } from '../types/wallet.js';
import type { Rng } from '../utils/prng.js';
import { demoAddress } from '../utils/hash.js';
import type { DemoArchetype, DemoWallet } from './types.js';

interface ArchetypePlan {
  archetype: DemoArchetype;
  count: number;
  primaryClass: WalletClass;
}

// Sums to 250.
const WALLET_PLAN: ArchetypePlan[] = [
  { archetype: 'MEGA_WHALE', count: 5, primaryClass: 'MEGA_WHALE' },
  { archetype: 'WHALE', count: 15, primaryClass: 'WHALE' },
  { archetype: 'SMART_MONEY', count: 25, primaryClass: 'SMART_MONEY' },
  { archetype: 'LARGE_TRADER', count: 20, primaryClass: 'LARGE_TRADER' },
  { archetype: 'RETAIL', count: 124, primaryClass: 'RETAIL' },
  { archetype: 'NEW_WALLET', count: 30, primaryClass: 'NEW_WALLET' },
  { archetype: 'BOT', count: 15, primaryClass: 'BOT' },
  { archetype: 'DEPLOYER', count: 3, primaryClass: 'DEPLOYER_LINKED' },
  { archetype: 'DEPLOYER_LINKED', count: 12, primaryClass: 'DEPLOYER_LINKED' },
  { archetype: 'MARKET_MAKER', count: 1, primaryClass: 'MARKET_MAKER' },
];

/** Two shared funding sources seed the "many wallets, one funder" bot signal. */
export const BOT_FUNDING_SOURCES: Hex[] = [
  demoAddress('funding', 'botfleet', 0),
  demoAddress('funding', 'botfleet', 1),
];

export interface DemoWalletPopulation {
  wallets: DemoWallet[];
  /** Deployer wallets, in order (used to anchor deployer clusters to tokens). */
  deployers: DemoWallet[];
  /** Deployer-linked cluster wallets grouped by their deployer address. */
  clustersByDeployer: Map<Hex, DemoWallet[]>;
  marketMaker: DemoWallet;
}

export function generateWallets(rng: Rng): DemoWalletPopulation {
  const wallets: DemoWallet[] = [];
  const deployers: DemoWallet[] = [];
  const clusterMembers: DemoWallet[] = [];
  let index = 0;

  for (const plan of WALLET_PLAN) {
    for (let n = 0; n < plan.count; n++) {
      const address = demoAddress('wallet', plan.archetype, index);
      const wallet = buildWallet(rng, plan, address, index);
      wallets.push(wallet);
      if (plan.archetype === 'DEPLOYER') deployers.push(wallet);
      if (plan.archetype === 'DEPLOYER_LINKED') clusterMembers.push(wallet);
      index++;
    }
  }

  // Wire deployer-linked members to a deployer via a shared funding source.
  const clustersByDeployer = new Map<Hex, DemoWallet[]>();
  for (const d of deployers) clustersByDeployer.set(d.address, []);
  clusterMembers.forEach((member, i) => {
    const deployer = deployers[i % Math.max(1, deployers.length)]!;
    member.fundingSourceAddress = deployer.address;
    clustersByDeployer.get(deployer.address)!.push(member);
  });

  const marketMaker = wallets.find((w) => w.archetype === 'MARKET_MAKER')!;

  return { wallets, deployers, clustersByDeployer, marketMaker };
}

function buildWallet(rng: Rng, plan: ArchetypePlan, address: Hex, index: number): DemoWallet {
  const base: DemoWallet = {
    address,
    archetype: plan.archetype,
    primaryClass: plan.primaryClass,
    classificationConfidence: 70,
    portfolioUsd: 0,
    firstSeenDaysAgo: rng.float(10, 720),
    lifetimeTxs: rng.int(20, 4000),
    isProfitable: false,
  };

  switch (plan.archetype) {
    case 'MEGA_WHALE':
      base.portfolioUsd = rng.float(1_200_000, 8_000_000);
      base.classificationConfidence = rng.int(85, 97);
      base.isProfitable = rng.bool(0.6);
      break;
    case 'WHALE':
      base.portfolioUsd = rng.float(260_000, 900_000);
      base.classificationConfidence = rng.int(80, 94);
      base.isProfitable = rng.bool(0.55);
      break;
    case 'SMART_MONEY':
      base.portfolioUsd = rng.float(40_000, 400_000);
      base.classificationConfidence = rng.int(62, 90);
      base.isProfitable = true; // profitable histories
      base.lifetimeTxs = rng.int(60, 1200);
      break;
    case 'LARGE_TRADER':
      base.portfolioUsd = rng.float(50_000, 200_000);
      base.classificationConfidence = rng.int(60, 85);
      base.isProfitable = rng.bool(0.5);
      break;
    case 'RETAIL':
      base.portfolioUsd = rng.float(200, 9_000);
      base.classificationConfidence = rng.int(60, 85);
      base.isProfitable = rng.bool(0.35);
      break;
    case 'NEW_WALLET':
      base.portfolioUsd = rng.float(100, 4_000);
      base.classificationConfidence = rng.int(55, 80);
      base.firstSeenDaysAgo = rng.float(0.05, 6);
      base.lifetimeTxs = rng.int(1, 4);
      base.isProfitable = rng.bool(0.3);
      break;
    case 'BOT':
      base.portfolioUsd = rng.float(5_000, 60_000);
      base.classificationConfidence = rng.int(65, 90);
      base.fundingSourceAddress = BOT_FUNDING_SOURCES[index % BOT_FUNDING_SOURCES.length]!;
      base.lifetimeTxs = rng.int(500, 8000);
      base.isProfitable = rng.bool(0.5);
      break;
    case 'DEPLOYER':
      base.portfolioUsd = rng.float(100_000, 2_000_000);
      base.classificationConfidence = rng.int(70, 92);
      base.isProfitable = rng.bool(0.5);
      break;
    case 'DEPLOYER_LINKED':
      base.portfolioUsd = rng.float(2_000, 80_000);
      base.classificationConfidence = rng.int(50, 80);
      base.isProfitable = rng.bool(0.45);
      break;
    case 'MARKET_MAKER':
      base.portfolioUsd = rng.float(500_000, 3_000_000);
      base.classificationConfidence = rng.int(75, 95);
      base.lifetimeTxs = rng.int(5000, 40000);
      base.isProfitable = rng.bool(0.5);
      break;
  }

  return base;
}
