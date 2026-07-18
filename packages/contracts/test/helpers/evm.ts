/**
 * In-process EVM harness: pure-JS ganache node + ethers v6. No native builds, no
 * external downloads. Deterministic accounts so tests are reproducible.
 */
import Ganache from 'ganache';
import { ethers } from 'ethers';
import type { Compiled } from './compile.js';

export interface Evm {
  provider: ethers.BrowserProvider;
  accounts: string[];
  signers: ethers.JsonRpcSigner[];
  deploy: (c: Compiled, args?: unknown[], from?: number) => Promise<ethers.Contract>;
  at: (c: Compiled, address: string, from?: number) => ethers.Contract;
  stop: () => Promise<void>;
}

export async function makeEvm(): Promise<Evm> {
  const node = (
    Ganache as unknown as { provider: (o: unknown) => ethers.Eip1193Provider & { disconnect: () => Promise<void> } }
  ).provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 8 },
    miner: { instamine: 'strict' },
    chain: { chainId: 4663, hardfork: 'merge' }, // merge/paris matches the compiled bytecode
  });
  const provider = new ethers.BrowserProvider(node);
  // ganache instamines, so poll receipts faster than ethers' 4s default (which
  // would stall every tx.wait() ~4s) — but not so fast it floods the JS transport.
  provider.pollingInterval = 250;
  const accounts: string[] = await provider.send('eth_accounts', []);
  const signers = await Promise.all(accounts.map((a) => provider.getSigner(a)));

  const deploy = async (c: Compiled, args: unknown[] = [], from = 0): Promise<ethers.Contract> => {
    const factory = new ethers.ContractFactory(c.abi, c.bytecode, signers[from]);
    const inst = await factory.deploy(...args);
    await inst.waitForDeployment();
    return inst as unknown as ethers.Contract;
  };
  const at = (c: Compiled, address: string, from = 0): ethers.Contract =>
    new ethers.Contract(address, c.abi, signers[from]);

  return { provider, accounts, signers, deploy, at, stop: () => node.disconnect() };
}
