// M5.11: SIWE_ORIGIN missing/empty -> wallet linking fails closed (503 wallet_link_unavailable); dev localhost fallback only when explicit.
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function mk(env: Record<string, string>) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0 });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m511-user-label-xx" }) })).json() as any).accessToken;
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  return { q, call };
}
const ADDR = "0x" + "12".repeat(20);
describe("M5.11 SIWE_ORIGIN fail-closed", () => {
  for (const [name, env] of [["unset", {}], ["empty", { SIWE_ORIGIN: "" }], ["dev flag false", { SIWE_DEV_LOCALHOST: "false" }], ["dev flag true outside mock (testnet) is ignored", { QUIVR_MODE: "testnet", QUIVR_JWT_SECRET: "x".repeat(48), SIWE_DEV_LOCALHOST: "true" }]] as const)
    it(`${name} → challenge + verify 503 wallet_link_unavailable; auth config says disabled`, async () => {
      const s = await mk(env as Record<string, string>);
      for (const [p, b] of [["/wallets/link/challenge", { address: ADDR }], ["/wallets/link/verify", { nonce: "a".repeat(32), signature: "0x" + "1".repeat(130) }]] as const) {
        const r = await s.call("POST", p, b); expect(r.status).toBe(503); expect(r.j.error?.code ?? r.j.code).toBe("wallet_link_unavailable"); }
      expect((await (await s.q.app.request("/v1/auth/config")).json() as any).walletLink.enabled).toBe(false);
    });
  it("dev fallback only with QUIVR_MODE=mock + SIWE_DEV_LOCALHOST=true; explicit origin wins", async () => {
    const d = await mk({ SIWE_DEV_LOCALHOST: "true" }); const r = await d.call("POST", "/wallets/link/challenge", { address: ADDR }); expect(r.status).toBe(200); expect(r.j.domain).toBe("localhost:3000");
    const e = await mk({ SIWE_ORIGIN: "https://app.quiver.example" }); expect((await e.call("POST", "/wallets/link/challenge", { address: ADDR })).j.uri).toBe("https://app.quiver.example");
    expect(() => loadConfig({ SIWE_ORIGIN: "javascript:alert(1)" })).toThrow();
  });
});
