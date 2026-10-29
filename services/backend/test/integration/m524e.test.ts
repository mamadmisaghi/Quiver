// M5.24e: swap prepare checks the user's input-token balance → 422 insufficient_balance.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { ApiError, HTTP_STATUS } from "../../contracts/src/errors";
import type { PoolReader } from "../../src/testpool";
import { T0 } from "../helpers";

const P = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0", U = "0x5fbdb2315678afecb367f032d93f642f64180aa3", N = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512", W = "0x1111111111111111111111111111111111111111";
const reader = (bal: bigint): PoolReader => ({ getChainId: async () => 46630, readContract: async ({ functionName, address }) => {
  switch (functionName) { case "decimals": return address.toLowerCase() === U ? 6 : 18; case "token0": return U; case "reserve0": return 20_000_000_000n; case "reserve1": return 10n ** 20n;
    case "quote": return 10n ** 17n; case "allowance": return 0n; case "balanceOf": return bal; default: throw new Error(functionName); } } });
async function swap(bal: bigint, amount: string) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", TEST_POOL_ENABLED: "true", TEST_POOL_ADDRESS: P, TEST_USDG_ADDRESS: U, TEST_NVDA_ADDRESS: N }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0, testPool: { reader: reader(bal) } });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m524e-balance-user-label" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id;
  q.store.users.get(me)!.linkedWallets = [{ address: W, linkedAt: T0 } as any];
  return q.app.request("/v1/testpool/swap/prepare", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ chainId: 46630, side: "buy", amount, from: W }) });
}
describe("M5.24e insufficient_balance", () => {
  it("422 with have/need when balance < amount", async () => {
    expect(HTTP_STATUS.insufficient_balance).toBe(422);
    const r = await swap(5_000_000n, "20"); expect(r.status).toBe(422);
    const j = ApiError.parse(await r.json()); expect(j.error.code).toBe("insufficient_balance");
    expect(j.error.details).toMatchObject({ have: "5", need: "20", symbol: "tUSDG", haveUnits: "5000000", needUnits: "20000000" }); expect(String((j.error.details as any).token).toLowerCase()).toBe(U);
  });
  it("exact balance passes", async () => { expect((await swap(20_000_000n, "20")).status).toBe(200); });
});
