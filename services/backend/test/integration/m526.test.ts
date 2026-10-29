// M5.26: bigint base-unit caps (deposit + swap), HOST listen default, committed checks.sh with relative paths.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { listenOpts } from "../../src/listen";
import type { PoolReader } from "../../src/testpool";
import { T0 } from "../helpers";

const W = "0x1111111111111111111111111111111111111111", SA = "0x2222222222222222222222222222222222222222";
const P = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0", U = "0x5fbdb2315678afecb367f032d93f642f64180aa3", N = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const fake: PoolReader = { getChainId: async () => 46630, getCode: async () => "0x6080", readContract: async ({ functionName }) => {
  switch (functionName) { case "decimals": return 6; case "token0": return U; case "reserve0": return 20_000_000_000n; case "reserve1": return 100n * 10n ** 18n; case "quote": return 123n; case "allowance": return 0n; case "balanceOf": return 10n ** 30n; default: throw new Error(functionName); } } };
async function setup() {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", TEST_POOL_ENABLED: "true", TEST_POOL_ADDRESS: P, TEST_USDG_ADDRESS: U, TEST_NVDA_ADDRESS: N }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0, testPool: { reader: fake } });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m526-bigint-cap-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  q.store.sessionKeys.set("sk_m526000000", { id: "sk_m526000000", ownerId: me, status: "active", policy: { chainId: 46630 } as any, address: W, smartAccount: SA, typedData: {}, createdAt: T0, spent: { day: "", usd: 0 }, revokeTx: null });
  const h = { "content-type": "application/json", authorization: `Bearer ${tok}` };
  return {
    dep: async (asset: string, amount: string) => (await q.app.request("/v1/testnet/deposit/prepare", { method: "POST", headers: h, body: JSON.stringify({ chainId: 46630, asset, amount, from: W }) })).status,
    quote: async (side: string, amount: string) => (await q.app.request(`/v1/testpool/quote?side=${side}&amount=${amount}`, { headers: h })).status,
    swap: async (side: string, amount: string) => (await q.app.request("/v1/testpool/swap/prepare", { method: "POST", headers: h, body: JSON.stringify({ chainId: 46630, side, amount, from: W }) })).status };
}
describe("M5.26 bigint caps", () => {
  it("deposit: 1 ETH ok, 1 ETH + 1 wei rejected; same at the tUSDG / tNVDA caps", async () => {
    const t = await setup();
    expect(await t.dep("ETH", "1")).toBe(200); expect(await t.dep("ETH", "1.000000000000000001")).toBe(422);
    expect(Number("1.000000000000000001")).toBe(1); // the bug Number() had
    expect(await t.dep("tUSDG", "1000000")).toBe(200); expect(await t.dep("tUSDG", "1000000.000001")).toBe(422);
    expect(await t.dep("tNVDA", "10000")).toBe(200); expect(await t.dep("tNVDA", "10000.000000000000000001")).toBe(422);
    expect(await t.dep("ETH", "0.000000000000000000")).toBe(422);
  });
  it("swap quote + prepare: buy cap 1,000,000 tUSDG, sell cap 10,000 tNVDA (base units)", async () => {
    const t = await setup();
    expect(await t.quote("buy", "1000000")).toBe(200); expect(await t.quote("buy", "1000000.000001")).toBe(422);
    expect(await t.quote("sell", "10000")).toBe(200); expect(await t.quote("sell", "10000.000001")).toBe(422);
    expect(await t.swap("buy", "1000000.000001")).toBe(422); expect(await t.swap("sell", "10000.000001")).toBe(422);
  });
});
describe("M5.26 HOST + checks.sh", () => {
  it("HOST defaults to 127.0.0.1 and is passed to serve()", () => {
    expect(listenOpts(loadConfig({ QUIVR_MODE: "mock" }))).toEqual({ hostname: "127.0.0.1", port: 8787 });
    expect(listenOpts(loadConfig({ QUIVR_MODE: "mock", HOST: "::1", PORT: "8987" }))).toEqual({ hostname: "::1", port: 8987 });
  });
  it("scripts/checks.sh uses no absolute repo paths", () => {
    const s = readFileSync(join(__dirname, "../../scripts/checks.sh"), "utf8");
    expect(s).not.toMatch(/\/workspace\//); expect(s).toMatch(/dirname "\$0"/); expect(s).toMatch(/ALL CHECKS PASSED/);
  });
});
