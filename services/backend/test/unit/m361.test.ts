/** M3.6.1: session-key maxSlippagePct, default caps, minSwapUsd rounding. */
import { describe, expect, it } from "vitest";
import { PrepareSessionKeyRes, SessionKey, SessionKeyDefaults, SessionKeyPolicy } from "../../contracts/src/api";
import { MemStore } from "../../src/store";
import { MOCK_TARGETS, MockSigner, SessionKeyService, minSwapUsd, sessionKeyDefaults, slippagePctFromBps } from "../../src/sessionkeys/service";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";

const registry = new Registry(MOCK_INSTRUMENTS);
const mk = () => { const store = new MemStore(); return { store, svc: new SessionKeyService(store, registry, new MockSigner(), { mode: "mock", targets: () => MOCK_TARGETS, defaults: { maxDays: 30, perTxUsd: 250, dailyUsd: 1000 }, now: () => Date.parse("2026-10-27T00:00:00Z") }) }; };
const req = { chainId: 46630 as const, tokens: ["robinhood:token:0x00000000000000000000000000000000000000a1"], perTxCapUsd: "250", dailyCapUsd: "1000", expiresInDays: 7 };
const OWNER = "0x1111111111111111111111111111111111111111";

describe("M3.6.1 defaults", () => {
  it("match SIGNOFF: $250 / $1000 / $15.63 / 1%", () => {
    const d = sessionKeyDefaults(250, 1000);
    expect(d).toEqual({ perTradeCapUsd: 250, dailyCapUsd: 1000, minSwapUsd: 15.63, maxSlippagePct: 1, defaultExpiryHours: 24, maxExpiryHours: 168, maxDailyToPerTradeRatio: 64 });
    expect(SessionKeyDefaults.parse(d)).toEqual(d);
  });
  it("minSwapUsd rounds UP to the cent; exact values unchanged", () => {
    expect(minSwapUsd(1000)).toBe(15.63); expect(minSwapUsd(640)).toBe(10); expect(minSwapUsd(100)).toBe(1.57); expect(minSwapUsd(64.01)).toBe(1.01);
  });
});

describe("M3.6.1 maxSlippagePct", () => {
  it("bps → pct, unset/invalid → 1, never above 10", () => {
    expect(slippagePctFromBps(undefined)).toBe(1); expect(slippagePctFromBps(100)).toBe(1); expect(slippagePctFromBps(250)).toBe(2.5);
    expect(slippagePctFromBps(1000)).toBe(10); expect(slippagePctFromBps(1001)).toBe(1); expect(slippagePctFromBps(0)).toBe(1); expect(slippagePctFromBps(-5)).toBe(1); expect(slippagePctFromBps(12.5)).toBe(1);
  });
  it("policy defaults to 1 and carries defaults in the prepare response", () => {
    const { svc } = mk(); const p = svc.prepare("u1", OWNER, req as any);
    expect(p.policy.maxSlippagePct).toBe(1); expect(p.defaults.minSwapUsd).toBe(15.63);
    PrepareSessionKeyRes.parse(p); SessionKey.parse(svc.view(svc.get("u1", p.sessionKeyId)));
  });
  it("sourced from the account's raised slippage cap (≤ 10%)", () => {
    const { svc, store } = mk(); store.accountSlippageCapBps.set(svc.smartAccountFor(OWNER).toLowerCase(), 750);
    expect(svc.prepare("u1", OWNER, req as any).policy.maxSlippagePct).toBe(1); // M3.9: default stays 1 even when the cap is raised
    const p = svc.prepare("u1", OWNER, { ...req, maxSlippagePct: 7.5 } as any); expect(p.policy.maxSlippagePct).toBe(7.5); expect(p.grant.maxSlippageBps).toBe(750);
  });
  it("schema rejects > 10 and missing", () => {
    const { svc } = mk(); const pol = svc.prepare("u1", OWNER, req as any).policy;
    expect(SessionKeyPolicy.safeParse({ ...pol, maxSlippagePct: 10.01 }).success).toBe(false);
    const { maxSlippagePct: _x, ...rest } = pol; expect(SessionKeyPolicy.safeParse(rest).success).toBe(false);
  });
});
