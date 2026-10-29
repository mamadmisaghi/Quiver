// M5.24f: optional tNVDA deposit (18 dp) via ERC20 transfer; 503 when TEST_NVDA_ADDRESS is empty.
import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { DepositPrepareRes } from "../../contracts/src/testnet";
import { T0 } from "../helpers";

const W = "0x1111111111111111111111111111111111111111", SA = "0x2222222222222222222222222222222222222222", NV = "0x4444444444444444444444444444444444444444";
async function setup(env: Record<string, string> = {}) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m524f-nvda-user-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  q.store.sessionKeys.set("sk_m524f00000", { id: "sk_m524f00000", ownerId: me, status: "active", policy: { chainId: 46630 } as any, address: W, smartAccount: SA, typedData: {}, createdAt: T0, spent: { day: "", usd: 0 }, revokeTx: null });
  return (amount: string) => q.app.request("/v1/testnet/deposit/prepare", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ chainId: 46630, asset: "tNVDA", amount, from: W }) });
}
describe("M5.24f tNVDA deposit", () => {
  it("503 when TEST_NVDA_ADDRESS is empty", async () => { expect((await (await setup())("1")).status).toBe(503); });
  it("transfer(smartAccount, 18-dp units) to the tNVDA token", async () => {
    const d = DepositPrepareRes.parse(await (await (await setup({ TEST_NVDA_ADDRESS: NV }))("0.5")).json());
    expect(d.tx.to).toBe(NV); expect(d.token).toBe(NV); expect(d.decimals).toBe(18); expect(d.tx.value).toBe("0");
    expect(decodeFunctionData({ abi: erc20Abi, data: d.tx.data as any }).args).toEqual([SA, 5n * 10n ** 17n]);
  });
  it("cap 10,000 tNVDA", async () => { const post = await setup({ TEST_NVDA_ADDRESS: NV }); expect((await post("10000")).status).toBe(200); expect((await post("10001")).status).toBe(422); });
});
