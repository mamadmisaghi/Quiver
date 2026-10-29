// M5.22 Slice B: paper revenue ledger behind REVENUE_ACCOUNTING_ENABLED + CREATOR_SHARE_BPS (never pays).
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { RevenueRes } from "../../contracts/src/ext";
import { T0 } from "../helpers";

async function setup(env: Record<string, string>) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  const tok = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m522b-author-label-xx" }) })).json() as any).accessToken;
  const me = (await (await q.app.request("/v1/me", { headers: { authorization: `Bearer ${tok}` } })).json() as any).id; const st = { name: "Author strat" } as any;
  const row = (id: string, ownerId: string, extra: any) => q.store.strategies.set(id, { id, ownerId, archived: false, versions: [{ version: 1, strategy: st, humanized: {} as any, issues: [], createdAt: T0 }], createdAt: T0, updatedAt: T0, ...extra });
  row("stg_author0000", me, { public: true, forks: 2 });
  row("stg_fork000000", "usr_other", { forkedFrom: "stg_author0000" });
  row("stg_copy000000", "usr_other2", { copyOf: { publicStrategyId: "stg_author0000", handle: "@a", sourceVersion: 1, copiedAt: T0, syncedAt: T0 } });
  row("stg_self000000", me, { forkedFrom: "stg_author0000" }); // own fork never accrues
  const fill = (n: string, f: string) => ({ type: "fill", notionalUsd: n, feeUsd: f }) as any;
  const run = (id: string, ownerId: string, strategyId: string, mode: any, events: any[]) => q.store.runs.set(id, { id, ownerId, strategyId, strategyVersion: 1, mode, status: "stopped", startedAt: T0, stoppedAt: T0, startingEquity: 10000, events });
  run("run1", "usr_other", "stg_fork000000", "paper", [fill("1000.00", "1.00"), fill("500.00", "0.50")]);
  run("run2", "usr_other2", "stg_copy000000", "paper", [fill("2000.00", "2.00")]);
  run("run3", me, "stg_self000000", "paper", [fill("9999.00", "9.99")]);
  run("run4", "usr_other", "stg_fork000000", "testnet", [fill("9999.00", "9.99")]);
  return async () => { const j = await (await q.app.request("/v1/revenue", { headers: { authorization: `Bearer ${tok}` } })).json(); const p = RevenueRes.safeParse(j); if (!p.success) throw p.error; return p.data; };
}

describe("M5.22 Slice B revenue ledger", () => {
  it("off by default: zeros, creatorSharePct null, accounting off", async () => {
    const r = await (await setup({}))(); expect(r).toMatchObject({ accounting: "off", earnedUsd: "0.00", creatorSharePct: null, claimEnabled: false });
    expect(r.rows[0].followersVolumeUsd).toBe("0.00");
  });
  it("flag without a share stays off", async () => { expect((await (await setup({ REVENUE_ACCOUNTING_ENABLED: "true" }))()).accounting).toBe("off"); });
  it("on: accrues other users' paper fills of forks/copies only; nothing claimable", async () => {
    const r = await (await setup({ REVENUE_ACCOUNTING_ENABLED: "true", CREATOR_SHARE_BPS: "2000" }))();
    expect(r).toMatchObject({ accounting: "paper_ledger", creatorSharePct: "20.00", claimableUsd: "0.00", claimEnabled: false, mock: true });
    const a = r.rows.find((x) => x.strategyId === "stg_author0000")!; expect(a.followersVolumeUsd).toBe("3500.00"); expect(a.earnedUsd).toBe("0.70"); expect(r.earnedUsd).toBe("0.70");
  });
  it("share bound 0..5000", () => { expect(() => loadConfig({ QUIVR_MODE: "mock", CREATOR_SHARE_BPS: "5001" })).toThrow(); });
});
