import { afterAll, describe, expect, it } from "vitest";
import { Market } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { MockMarket } from "../../src/venues/market";

const LANDING = "If Fed-cut odds on Polymarket pass 70% and NVDA trades under its 20-day average, buy $200 of NVDA on Robinhood Chain and open a 2× SOL long with $250 on Hyperliquid. Stop at −8%.";
const mk = (env: Record<string, string>) => { const registry = new Registry(MOCK_INSTRUMENTS); return createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), registry, market: new MockMarket(registry), autoTimers: false, compileDelayMs: 0 }); };

describe("M3.2 HTTP", () => {
  const apps = [mk({}), mk({ PRICE_SOURCE: "mainnet-readonly", MAINNET_READONLY_RPC_URL: "https://example.invalid" })];
  afterAll(() => apps.forEach((a) => a.runs.shutdown()));
  const call = async (a: ReturnType<typeof mk>, token: string, method: string, p: string, body?: unknown) => {
    const r = await a.app.request("/v1" + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let json: any; try { json = JSON.parse(t); } catch { json = t.trim().split("\n").map((l) => JSON.parse(l)); } return { status: r.status, json };
  };
  const login = async (a: ReturnType<typeof mk>) => (await call(a, "", "POST", "/auth/exchange", { provider: "privy", idToken: "dev:m32-http-user-000001" })).json.accessToken as string;

  it("markets: clean names, mock-ness in isMock/addressVerified", async () => {
    const tok = await login(apps[0]); const m = await call(apps[0], tok, "GET", "/markets?limit=50");
    for (const x of m.json.items) { Market.parse(x); expect(x.name).not.toMatch(/MOCK/); expect(x.isMock).toBe(true); }
    const nv = m.json.items.find((x: any) => x.symbol === "NVDA"); expect(nv.name).toBe("NVIDIA"); expect(nv.addressVerified).toBe(false);
    expect(m.json.items.find((x: any) => x.id === "hl:perp:SOL").addressVerified).toBeNull();
  });
  it("rewards/leaderboard notice reflects the price mode", async () => {
    for (const [i, a] of apps.entries()) {
      const tok = await login(a); const r = await call(a, tok, "GET", "/rewards"); expect(r.status).toBe(200);
      expect(r.json.notice).toMatch(/^Example data\./); expect(r.json.notice).not.toMatch(/mock mode/i);
      const lb = await call(a, tok, "GET", "/leaderboard?window=30d");
      if (lb.status === 200) expect(lb.json.notice).toMatch(i === 0 ? /synthetic \(mock\)/ : /Chainlink mainnet read-only/);
    }
  });
  it("POST /compile handles the landing prompt (demo, 2 actions, 3 venues)", async () => {
    const r = await call(apps[0], "", "POST", "/compile", { thesis: LANDING });
    expect(r.status).toBe(200);
    const flat = Array.isArray(r.json) ? r.json : [r.json];
    const s = flat.map((e: any) => e.strategy ?? e.data?.strategy).find(Boolean); expect(s).toBeTruthy();
    expect(s.actions.map((a: any) => a.instrument)).toEqual([MOCK_INSTRUMENTS[0].id, "hl:perp:SOL"]);
    expect(s.signals.some((x: any) => x.params?.instrument === "pm:outcome:fed-cut-december:YES")).toBe(true);
  });
});
