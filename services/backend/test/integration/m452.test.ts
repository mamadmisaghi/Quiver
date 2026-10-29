// M4.5.2 — landing notice follows PRICE_SOURCE; failed/empty landing preview retried after ~60 s; ops stop scripts' defaults.
import { readFileSync } from "node:fs"; import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
const fail = { on: false, calls: 0 };
vi.mock("../../src/backtest/backtest", async (orig) => { const m = await orig<typeof import("../../src/backtest/backtest")>();
  return { ...m, runBacktest: (...a: Parameters<typeof m.runBacktest>) => { fail.calls++; return fail.on ? Promise.reject(new Error("boom")) : m.runBacktest(...a); } }; });
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

const mk = (env: Record<string, string> = {}) => { const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  return { clock, q: createApp({ config: loadConfig({ QUIVR_MODE: "mock", ...env }), clock, autoTimers: false, compileDelayMs: 0 }) }; };
const landing = async (q: ReturnType<typeof createApp>, ip: string) => (await q.app.request("/v1/public/landing", { headers: { "x-forwarded-for": ip } })).json() as Promise<any>;

describe("M4.5.2 landing", () => {
  it("notice names the configured price source", async () => {
    expect((await landing(mk().q, "10.0.0.1")).notice).toMatch(/synthetic \(mock\) prices/);
    const ro = await landing(mk({ PRICE_SOURCE: "mainnet-readonly" }).q, "10.0.0.2");
    expect(ro.notice).toMatch(/Chainlink mainnet read-only/); expect(ro.notice).not.toMatch(/\(mock\)/);
  });
  it("a failed preview is cached ~60 s, not an hour", async () => {
    const { q, clock } = mk(); fail.on = true; fail.calls = 0;
    expect((await landing(q, "10.0.1.1")).preview).toBeNull(); const c1 = fail.calls;
    clock.advance(30_000); await landing(q, "10.0.1.1"); expect(fail.calls).toBe(c1); // still cached
    fail.on = false; clock.advance(31_000); expect((await landing(q, "10.0.1.1")).preview).not.toBeNull(); expect(fail.calls).toBe(c1 + 1);
    clock.advance(120_000); await landing(q, "10.0.1.1"); expect(fail.calls).toBe(c1 + 1); // a good preview keeps its hourly cache
  });
});

describe("M4.5.2 ops scripts", () => {
  const dir = join(__dirname, "../../scripts/ops");
  it("stop-api.cmd: no PowerShell, curl.exe, args→env→VPS defaults 8987/QuiverApi", () => {
    const s = readFileSync(join(dir, "stop-api.cmd"), "utf8");
    const code = s.split(/\r\n/).filter((l) => !/^rem /i.test(l)).join("\n"); expect(code).not.toMatch(/powershell|Invoke-/i); expect(s).toMatch(/curl\.exe/); expect(s).toMatch(/set "PORT=8987"/); expect(s).toMatch(/set "TASK=QuiverApi"/);
    expect(s).toMatch(/%~1/); expect(s).toMatch(/QUIVER_PORT/); expect(s).toMatch(/QUIVER_TASK/); expect(s).toMatch(/\r\n/);
  });
  it("stop-api.ps1 defaults match the VPS", () => {
    const s = readFileSync(join(dir, "stop-api.ps1"), "utf8"); expect(s).toMatch(/\$Port = 8987/); expect(s).toMatch(/\$Task = "QuiverApi"/); expect(s).not.toMatch(/8787|QuiverAPI/);
  });
});
