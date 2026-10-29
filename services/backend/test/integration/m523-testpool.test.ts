// M5.23 Slice 3: test-pool wiring. Unit (fake reader): disabled when any env empty, chain mismatch, validation.
// Anvil (local only, skipped without Foundry): runs the REAL DeployTestPool.s.sol against anvil (unlocked dev account,
// no key anywhere), then reads quotes through the app and executes the app's unsigned txs from an unlocked anvil account.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAnvil } from "../anvil";
import { execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { foundry } from "viem/chains";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { TestPoolStatusRes, TestPoolQuoteRes, TestPoolSwapPrepareRes } from "../../contracts/src/testnet";
import type { PoolReader } from "../../src/testpool";
import { T0 } from "../helpers";

const P = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0", U = "0x5fbdb2315678afecb367f032d93f642f64180aa3", N = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const ENV = { TEST_POOL_ENABLED: "true", TEST_POOL_ADDRESS: P, TEST_USDG_ADDRESS: U, TEST_NVDA_ADDRESS: N };
async function setup(env: Record<string, string>, reader?: PoolReader, expectChainId?: number, wallet?: string, now = T0) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(now), autoTimers: false, compileDelayMs: 0, ...(reader ? { testPool: { reader, expectChainId } } : {}) });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m523-testpool-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  if (wallet) q.store.users.get(me)!.linkedWallets = [{ address: wallet, linkedAt: T0 } as any];
  const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  return { status: () => q.app.request("/v1/testpool/status"), quote: (qs: string) => q.app.request(`/v1/testpool/quote?${qs}`, { headers: h }),
    swap: (b: any) => q.app.request("/v1/testpool/swap/prepare", { method: "POST", headers: h, body: JSON.stringify(b) }) };
}
const fake = (chainId: number): PoolReader => ({ getChainId: async () => chainId, readContract: async ({ functionName }) => {
  switch (functionName) { case "decimals": return 6; case "token0": return U; case "reserve0": return 20_000_000_000n; case "reserve1": return 100n * 10n ** 18n; case "quote": return 123n; case "allowance": return 0n; case "balanceOf": return 10n ** 30n; default: throw new Error(functionName); } } });

describe("M5.23 test pool (unit)", () => {
  it("disabled by default and when any address is empty; routes 503", async () => {
    for (const env of [{}, { ...ENV, TEST_POOL_ADDRESS: "" }, { ...ENV, TEST_POOL_ENABLED: "false" }]) {
      const a = await setup(env, fake(46630)); const s = TestPoolStatusRes.parse(await (await a.status()).json());
      expect(s.enabled).toBe(false); expect(s.missing.length).toBeGreaterThan(0);
      expect((await a.quote("side=buy&amount=10")).status).toBe(503);
    }
    const s = TestPoolStatusRes.parse(await (await (await setup(ENV, fake(46630))).status()).json()); expect(s).toMatchObject({ enabled: true, missing: [], chainId: 46630 });
  });
  it("refuses an RPC that is not 46630 (e.g. mainnet 4663)", async () => {
    expect((await (await setup(ENV, fake(4663))).quote("side=buy&amount=10")).status).toBe(503);
  });
  it("swap prepare refuses other chains, unlinked wallets; validates slippage", async () => {
    const W = "0x1111111111111111111111111111111111111111"; const a = await setup(ENV, fake(46630), undefined, W);
    const ok = { chainId: 46630, side: "buy", amount: "10", from: W };
    for (const chainId of [4663, 1, 31337]) expect((await a.swap({ ...ok, chainId })).status).toBe(422);
    expect((await a.swap({ ...ok, from: "0x9999999999999999999999999999999999999999" })).status).toBe(409);
    expect((await a.swap({ ...ok, slippageBps: 5000 })).status).toBe(422);
    const d = TestPoolSwapPrepareRes.parse(await (await a.swap(ok)).json()); expect(d.txs.map((t) => t.kind)).toEqual(["approve", "swap"]);
    expect(d.txs.every((t) => t.tx.chainId === 46630 && t.tx.value === "0")).toBe(true);
  });
});

const BIN = join(homedir(), ".foundry/bin"); const HAS = existsSync(join(BIN, "anvil"));
const AN = HAS ? await startAnvil(31337) : null; const RPC = AN?.rpc ?? "http://127.0.0.1:1"; // M5.27: free port per file
const DEV0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", DEV1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil's unlocked dev accounts (no key used)
describe.skipIf(!HAS)("M5.23 test pool on local anvil (DeployTestPool.s.sol)", () => {
  let anvil: ChildProcess; const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const A: Record<string, Hex> = {};
  const erc = parseAbi(["function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
  const sendAs = async (from: string, to: string, data: string) => {
    const hash = await pub.request({ method: "eth_sendTransaction" as never, params: [{ from, to, data, value: "0x0" }] as never }) as Hex;
    const r = await pub.waitForTransactionReceipt({ hash }); expect(r.status).toBe("success");
  };
  beforeAll(async () => {
    anvil = AN!.proc;
    execFileSync(join(BIN, "forge"), ["script", "script/DeployTestPool.s.sol", "--rpc-url", RPC, "--unlocked", "--sender", DEV0, "--broadcast"], { cwd: "foundry", stdio: "ignore", env: { ...process.env, TEST_POOL_SEED_NVDA: "100" } });
    const run = JSON.parse(readFileSync("foundry/broadcast/DeployTestPool.s.sol/31337/run-latest.json", "utf8"));
    const made = run.transactions.filter((t: any) => t.transactionType === "CREATE");
    [A.usdg, A.nvda, A.pool] = [made[0].contractAddress, made[1].contractAddress, made[2].contractAddress];
  }, 120_000);
  afterAll(() => { anvil?.kill(); rmSync("foundry/broadcast/DeployTestPool.s.sol/31337", { recursive: true, force: true }); });

  it("read-only quote matches pool.quote; swap-prepare txs execute when the user's wallet sends them", async () => {
    const env = { TEST_POOL_ENABLED: "true", TEST_POOL_ADDRESS: A.pool, TEST_USDG_ADDRESS: A.usdg, TEST_NVDA_ADDRESS: A.nvda };
    const now = Number((await pub.getBlock()).timestamp) * 1000;
    const a = await setup(env, pub as unknown as PoolReader, 31337, DEV1, now);
    const blk0 = await pub.getBlockNumber({ cacheTime: 0 });
    const q = TestPoolQuoteRes.parse(await (await a.quote("side=buy&amount=200")).json());
    expect(await pub.getBlockNumber({ cacheTime: 0 })).toBe(blk0); // quotes never write
    expect(q.reserves).toEqual({ usdg: "20000000000", nvda: "100000000000000000000" });
    expect(Number(q.priceUsdgPerNvda)).toBeCloseTo(200, 6);
    const direct = await pub.readContract({ address: A.pool, abi: parseAbi(["function quote(address,uint256) view returns (uint256)"]), functionName: "quote", args: [A.usdg, 200_000_000n] });
    expect(q.amountOutUnits).toBe(direct.toString()); expect(Number(q.amountOut)).toBeLessThan(1);
    // M5.24e: before funding, swap prepare refuses with insufficient_balance (read from the real token)
    const poor = await a.swap({ chainId: 46630, side: "buy", amount: "200", from: DEV1 }); expect(poor.status).toBe(422);
    expect((await poor.json() as any).error).toMatchObject({ code: "insufficient_balance", details: { have: "0", need: "200", symbol: "tUSDG" } });
    // user's wallet (anvil unlocked DEV1) gets test tUSDG, then signs+sends what the app prepared
    await sendAs(DEV1, A.usdg, (await import("viem")).encodeFunctionData({ abi: erc, functionName: "mint", args: [DEV1, 1_000_000_000n] }));
    const d = TestPoolSwapPrepareRes.parse(await (await a.swap({ chainId: 46630, side: "buy", amount: "200", from: DEV1, slippageBps: 50 })).json());
    expect(d.txs.map((t) => t.kind)).toEqual(["approve", "swap"]); expect(await pub.getBlockNumber({ cacheTime: 0 })).toBe(blk0 + 1n);
    for (const t of d.txs) await sendAs(t.tx.from, t.tx.to, t.tx.data);
    const got = await pub.readContract({ address: A.nvda, abi: erc, functionName: "balanceOf", args: [DEV1] });
    expect(got).toBe(BigInt(q.amountOutUnits)); expect(got >= BigInt(d.minAmountOutUnits)).toBe(true);
    // allowance now spent → a second prepare with fresh approval needed; sell path works too
    const s = TestPoolSwapPrepareRes.parse(await (await a.swap({ chainId: 46630, side: "sell", amount: "0.1", from: DEV1 })).json());
    for (const t of s.txs) await sendAs(t.tx.from, t.tx.to, t.tx.data);
    expect(await pub.readContract({ address: A.nvda, abi: erc, functionName: "balanceOf", args: [DEV1] })).toBe(got - 10n ** 17n);
  }, 60_000);
});
