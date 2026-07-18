/**
 * BasketRouter tests: non-custodial buy / sell / rebalance against a mock DEX, plus
 * the guards (slippage, deadline, token registry, user allowlist, pause, owner-only,
 * reentrancy). Every happy path also asserts the router holds NO balance afterward.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compileAll } from './helpers/compile.js';
import { makeEvm, type Evm } from './helpers/evm.js';

let evm: Evm;
let C: ReturnType<typeof compileAll>;

const DL = 10_000_000_000n; // far-future deadline
const usd = (n: number): bigint => BigInt(n) * 10n ** 6n; // USDC has 6 decimals
const tok = (n: number): bigint => BigInt(n) * 10n ** 18n; // stock tokens have 18

const send = async (p: Promise<{ wait: () => Promise<unknown> }>): Promise<unknown> => (await p).wait();

interface Deployed {
  owner: string;
  user: string;
  usdc: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  aapl: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  msft: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  adapter: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  router: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  addr: Record<string, string>;
}

/** Fresh contracts per test for isolation. owner = accounts[0], user = accounts[1]. */
async function deployAll(): Promise<Deployed> {
  const owner = evm.accounts[0]!;
  const user = evm.accounts[1]!;
  const usdc = await evm.deploy(C.MockERC20!, ['USD Coin', 'USDC', 6]);
  const aapl = await evm.deploy(C.MockERC20!, ['Apple', 'AAPL', 18]);
  const msft = await evm.deploy(C.MockERC20!, ['Microsoft', 'MSFT', 18]);
  const adapter = await evm.deploy(C.MockSwapAdapter!, []);
  const addr = {
    usdc: await usdc.getAddress(),
    aapl: await aapl.getAddress(),
    msft: await msft.getAddress(),
    adapter: await adapter.getAddress(),
  } as Record<string, string>;
  const router = await evm.deploy(C.BasketRouter!, [addr.usdc, addr.adapter]);
  addr.router = await router.getAddress();

  await send(adapter.setPrice(addr.usdc, tok(1))); // $1
  await send(adapter.setPrice(addr.aapl, tok(200))); // $200
  await send(adapter.setPrice(addr.msft, tok(400))); // $400
  // Deep liquidity in the adapter.
  await send(usdc.mint(addr.adapter, usd(10_000_000)));
  await send(aapl.mint(addr.adapter, tok(1_000_000)));
  await send(msft.mint(addr.adapter, tok(1_000_000)));
  // Register the tradable tokens.
  await send(router.setTokensAllowed([addr.aapl, addr.msft], true));

  return { owner, user, usdc, aapl, msft, adapter, router, addr };
}

const asUser = (c: any, i = 1): any => c.connect(evm.signers[i]!); // eslint-disable-line @typescript-eslint/no-explicit-any

async function expectNoRouterBalance(d: Deployed): Promise<void> {
  expect(await d.usdc.balanceOf(d.addr.router)).toBe(0n);
  expect(await d.aapl.balanceOf(d.addr.router)).toBe(0n);
  expect(await d.msft.balanceOf(d.addr.router)).toBe(0n);
}

beforeAll(async () => {
  C = compileAll();
  evm = await makeEvm();
});
afterAll(async () => {
  await evm.stop();
});

describe('BasketRouter — buy', () => {
  it('buys a basket and delivers tokens to the user; router keeps nothing', async () => {
    const d = await deployAll();
    await send(d.usdc.mint(d.user, usd(1000)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(1000)));
    await send(
      asUser(d.router).buyBasket(
        [
          { token: d.addr.aapl, stableIn: usd(600), minTokenOut: 0 },
          { token: d.addr.msft, stableIn: usd(400), minTokenOut: 0 },
        ],
        DL,
      ),
    );
    expect(await d.aapl.balanceOf(d.user)).toBe(tok(3)); // $600 / $200
    expect(await d.msft.balanceOf(d.user)).toBe(tok(1)); // $400 / $400
    expect(await d.usdc.balanceOf(d.user)).toBe(0n); // fully spent
    await expectNoRouterBalance(d);
  });

  it('reverts on slippage when minTokenOut is not met', async () => {
    const d = await deployAll();
    await send(d.adapter.setFeeBps(100)); // 1% haircut
    await send(d.usdc.mint(d.user, usd(600)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(600)));
    await expect(
      asUser(d.router).buyBasket([{ token: d.addr.aapl, stableIn: usd(600), minTokenOut: tok(3) }], DL),
    ).rejects.toThrow();
  });

  it('reverts on an expired deadline', async () => {
    const d = await deployAll();
    await send(d.usdc.mint(d.user, usd(100)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(100)));
    await expect(
      asUser(d.router).buyBasket([{ token: d.addr.aapl, stableIn: usd(100), minTokenOut: 0 }], 1n),
    ).rejects.toThrow();
  });

  it('reverts when a leg token is not registered', async () => {
    const d = await deployAll();
    await send(d.router.setTokenAllowed(d.addr.aapl, false)); // de-register
    await send(d.usdc.mint(d.user, usd(100)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(100)));
    await expect(
      asUser(d.router).buyBasket([{ token: d.addr.aapl, stableIn: usd(100), minTokenOut: 0 }], DL),
    ).rejects.toThrow();
  });
});

describe('BasketRouter — sell', () => {
  it('sells holdings back to stablecoin; router keeps nothing', async () => {
    const d = await deployAll();
    await send(d.aapl.mint(d.user, tok(3)));
    await send(asUser(d.aapl).approve(d.addr.router, tok(3)));
    await send(asUser(d.router).sellBasket([{ token: d.addr.aapl, tokenIn: tok(3), minStableOut: 0 }], DL));
    expect(await d.usdc.balanceOf(d.user)).toBe(usd(600)); // 3 · $200
    expect(await d.aapl.balanceOf(d.user)).toBe(0n);
    await expectNoRouterBalance(d);
  });
});

describe('BasketRouter — rebalance', () => {
  it('sells and buys the diff, settles to the user, refunds nothing extra', async () => {
    const d = await deployAll();
    await send(d.aapl.mint(d.user, tok(3))); // $600 of AAPL
    await send(asUser(d.aapl).approve(d.addr.router, tok(3)));
    // Move to 50/50 AAPL/MSFT of $600: sell 1.5 AAPL ($300), buy $300 MSFT.
    await send(
      asUser(d.router).rebalance(
        [{ token: d.addr.aapl, tokenIn: (tok(3) * 1n) / 2n, minStableOut: 0 }],
        [{ token: d.addr.msft, stableIn: usd(300), minTokenOut: 0 }],
        0n,
        DL,
      ),
    );
    expect(await d.aapl.balanceOf(d.user)).toBe(tok(3) / 2n); // 1.5 AAPL left
    expect(await d.msft.balanceOf(d.user)).toBe((tok(1) * 3n) / 4n); // 0.75 MSFT ($300/$400)
    await expectNoRouterBalance(d);
  });

  it('deploys added cash on top of the sell proceeds', async () => {
    const d = await deployAll();
    await send(d.aapl.mint(d.user, tok(1))); // $200 AAPL
    await send(d.usdc.mint(d.user, usd(200))); // + $200 cash
    await send(asUser(d.aapl).approve(d.addr.router, tok(1)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(200)));
    // Sell all AAPL ($200) + add $200 cash = $400 → buy 1 MSFT.
    await send(
      asUser(d.router).rebalance(
        [{ token: d.addr.aapl, tokenIn: tok(1), minStableOut: 0 }],
        [{ token: d.addr.msft, stableIn: usd(400), minTokenOut: 0 }],
        usd(200),
        DL,
      ),
    );
    expect(await d.aapl.balanceOf(d.user)).toBe(0n);
    expect(await d.msft.balanceOf(d.user)).toBe(tok(1)); // $400 / $400
    expect(await d.usdc.balanceOf(d.user)).toBe(0n);
    await expectNoRouterBalance(d);
  });
});

describe('BasketRouter — guards', () => {
  it('gates trading behind the user allowlist when enabled', async () => {
    const d = await deployAll();
    await send(d.router.setUserAllowlistEnabled(true));
    await send(d.usdc.mint(d.user, usd(100)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(100)));
    const legs = [{ token: d.addr.aapl, stableIn: usd(100), minTokenOut: 0 }];
    await expect(asUser(d.router).buyBasket(legs, DL)).rejects.toThrow(); // not eligible
    await send(d.router.setUserAllowed(d.user, true));
    await send(asUser(d.router).buyBasket(legs, DL)); // now allowed
    expect(await d.aapl.balanceOf(d.user)).toBe(tok(1) / 2n); // $100 / $200
  });

  it('blocks trading while paused and resumes after unpause', async () => {
    const d = await deployAll();
    await send(d.usdc.mint(d.user, usd(200)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(200)));
    const legs = [{ token: d.addr.aapl, stableIn: usd(100), minTokenOut: 0 }];
    await send(d.router.pause());
    await expect(asUser(d.router).buyBasket(legs, DL)).rejects.toThrow();
    await send(d.router.unpause());
    await send(asUser(d.router).buyBasket(legs, DL));
    expect(await d.aapl.balanceOf(d.user)).toBe(tok(1) / 2n);
  });

  it('restricts admin functions to the owner', async () => {
    const d = await deployAll();
    await expect(asUser(d.router).setTokenAllowed(d.addr.aapl, false)).rejects.toThrow();
    await expect(asUser(d.router).pause()).rejects.toThrow();
  });

  it('reverts if a malicious adapter tries to re-enter', async () => {
    const d = await deployAll();
    const reentrant = await evm.deploy(C.ReentrantAdapter!, []);
    const reAddr = await reentrant.getAddress();
    await send(reentrant.set(d.addr.router, d.addr.aapl));
    await send(d.router.setAdapter(reAddr));
    await send(d.usdc.mint(d.user, usd(100)));
    await send(asUser(d.usdc).approve(d.addr.router, usd(100)));
    await expect(
      asUser(d.router).buyBasket([{ token: d.addr.aapl, stableIn: usd(100), minTokenOut: 0 }], DL),
    ).rejects.toThrow();
  });
});
