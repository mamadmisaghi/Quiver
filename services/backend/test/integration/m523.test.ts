// M5.23 Slice 2: testnet-only deposit prepare. Unsigned tx only; refuses non-46630 chains; auth + linked wallet; rate-limited.
import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { DepositPrepareRes } from "../../contracts/src/testnet";
import { T0 } from "../helpers";

const W = "0x1111111111111111111111111111111111111111", SA = "0x2222222222222222222222222222222222222222", TOK = "0x3333333333333333333333333333333333333333";
async function setup(env: Record<string, string> = {}, opts: { link?: boolean; sk?: boolean } = { link: true, sk: true }) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m523-deposit-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  if (opts.link) q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  if (opts.sk) q.store.sessionKeys.set("sk_m523000000", { id: "sk_m523000000", ownerId: me, status: "active", policy: { chainId: 46630 } as any, address: W, smartAccount: SA, typedData: {}, createdAt: T0, spent: { day: "", usd: 0 }, revokeTx: null });
  const post = (b: any, auth = true) => q.app.request("/v1/testnet/deposit/prepare", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b) });
  return post;
}
const ok = { chainId: 46630, asset: "ETH", amount: "0.05", from: W };

describe("M5.23 deposit prepare (testnet only, unsigned)", () => {
  it("ETH: unsigned value transfer to own smart account, chainId 46630", async () => {
    const res = await (await setup())(ok); expect(res.status).toBe(200);
    const d = DepositPrepareRes.parse(await res.json());
    expect(d.tx).toEqual({ chainId: 46630, from: W, to: SA, data: "0x", value: "50000000000000000" });
    expect(d.token).toBeNull(); expect(d.testnet).toBe(true); expect(JSON.stringify(d)).not.toMatch(/signature|privateKey|rawTx/i);
  });
  it("tUSDG: ERC20 transfer(smartAccount, units) to the token; 503 when token env empty", async () => {
    expect((await (await setup())({ ...ok, asset: "tUSDG", amount: "250" })).status).toBe(503);
    const d = DepositPrepareRes.parse(await (await (await setup({ TEST_USDG_ADDRESS: TOK }))({ ...ok, asset: "tUSDG", amount: "250.5" })).json());
    expect(d.tx.to).toBe(TOK); expect(d.tx.value).toBe("0");
    const call = decodeFunctionData({ abi: erc20Abi, data: d.tx.data as any }); expect(call.functionName).toBe("transfer");
    expect(call.args).toEqual([SA, 250_500_000n]);
  });
  it("refuses every other chain (4663 mainnet, 1, 31337)", async () => {
    const post = await setup();
    for (const chainId of [4663, 1, 31337]) { const r = await post({ ...ok, chainId }); expect(r.status).toBe(422); expect((await r.json() as any).error.details.reason).toBe("chain_not_allowed"); }
  });
  it("needs auth, a linked wallet and a smart account; validates amount", async () => {
    expect((await (await setup())(ok, false)).status).toBe(401);
    const nl = await (await setup({}, { sk: true }))(ok); expect(nl.status).toBe(409); expect((await nl.json() as any).error.details.reason).toBe("wallet_not_linked");
    const other = await (await setup())({ ...ok, from: "0x9999999999999999999999999999999999999999" }); expect(other.status).toBe(409);
    const ns = await (await setup({}, { link: true }))(ok); expect((await ns.json() as any).error.details.reason).toBe("no_smart_account");
    const post = await setup();
    for (const amount of ["0", "2", "abc", "-1"]) expect((await post({ ...ok, amount })).status).toBe(422);
    expect((await post({ ...ok, asset: "tUSDG", amount: "1.1234567" })).status).toBeGreaterThanOrEqual(422);
  });
  it("rate-limited per user (20/min)", async () => {
    const post = await setup(); const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await post(ok)).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true); expect(codes[21]).toBe(429);
  });
});
