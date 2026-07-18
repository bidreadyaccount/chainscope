/** Toolchain smoke test: compile solc → deploy on ganache → call via ethers. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { compileAll } from './helpers/compile.js';
import { makeEvm, type Evm } from './helpers/evm.js';

let evm: Evm;
let C: ReturnType<typeof compileAll>;

beforeAll(async () => {
  C = compileAll();
  evm = await makeEvm();
});
afterAll(async () => {
  await evm.stop();
});

describe('toolchain', () => {
  it('compiles, deploys, and calls a mock ERC-20', async () => {
    const token = await evm.deploy(C.MockERC20!, ['USD Coin', 'USDC', 6]);
    await (await token.mint(evm.accounts[1], 1_000_000n)).wait();
    expect(await token.decimals()).toBe(6n);
    expect(await token.balanceOf(evm.accounts[1])).toBe(1_000_000n);
    expect(ethers.isAddress(await token.getAddress())).toBe(true);
  });
});
