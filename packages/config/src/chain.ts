/**
 * Robinhood Chain network configuration.
 *
 * ⚠️ UNVERIFIED — check https://docs.robinhood.com/chain
 * The chainId, RPC and explorer values below were provided by the client and
 * have NOT been independently verified. Operators MUST confirm every value
 * against the official Robinhood Chain documentation before enabling live mode.
 * Never treat these as authoritative and never invent DEX/stablecoin addresses
 * to accompany them — those live (empty) in the environment configuration.
 */

export const ROBINHOOD_CHAIN_ID = 4663 as const;

export interface ChainNativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface ChainConfig {
  readonly id: typeof ROBINHOOD_CHAIN_ID;
  readonly name: string;
  readonly shortName: string;
  readonly nativeCurrency: ChainNativeCurrency;
  /** Public fallback RPC. Production should override via ROBINHOOD_RPC_URL. */
  readonly defaultRpcUrl: string;
  readonly explorerBaseUrl: string;
  /** True once the values here are verified against official docs. */
  readonly verified: boolean;
}

export const ROBINHOOD_CHAIN: ChainConfig = {
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  shortName: 'robinhood',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  // UNVERIFIED — check https://docs.robinhood.com/chain
  defaultRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  // UNVERIFIED — check https://docs.robinhood.com/chain
  explorerBaseUrl: 'https://robinhoodchain.blockscout.com',
  verified: false,
};

/** Only Robinhood Chain is supported in round 1. */
export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_CHAIN,
};

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS[chainId];
}

export function explorerTxUrl(txHash: string): string {
  return `${ROBINHOOD_CHAIN.explorerBaseUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ROBINHOOD_CHAIN.explorerBaseUrl}/address/${address}`;
}

export function explorerTokenUrl(address: string): string {
  return `${ROBINHOOD_CHAIN.explorerBaseUrl}/token/${address}`;
}
