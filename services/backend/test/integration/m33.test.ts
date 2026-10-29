import { afterAll, describe, expect, it } from "vitest";
import { Market } from "../../contracts/src/api";
import { createApp, type AssetInfo } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { MockMarket, type MarketData } from "../../src/venues/market";
import { Verified } from "../../src/verify/loader";

// Readonly-shaped market: Robinhood (except WETH, to cover mixed) priced by "Chainlink", JUP by Jupiter, rest mock.
const registry = new Registry(MOCK_INSTRUMENTS); const mock = new MockMarket(registry);
const market: MarketData = { ...mock, synthetic: true, closes: mock.closes.bind(mock), bars: mock.bars.bind(mock), funding: mock.funding.bind(mock), session: mock.session.bind(mock),
  price: (id, t) => { const m = registry.get(id)!; const p = mock.price(id, t); if (!p) return null;
    return m.venue === "robinhood" ? { ...p, source: "chainlink_mainnet_readonly" } : m.symbol === "JUP" ? { ...p, source: "jupiter_readonly" } : p; } };
const v = Verified.load("config/verified/4663-readonly.json"); const jv = v.jupiter()!;
const assetInfo: AssetInfo = (m) => m.venue === "robinhood" ? ((a) => (a ? { ...a, chainId: 4663 } : null))(v.tokenAddress(m.symbol)) : m.symbol === "JUP" ? { address: jv.mint, chainId: null, source: jv.source } : null;

describe("M3.3 price vs address flags", () => {
  const a = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", PRICE_SOURCE: "mainnet-readonly", MAINNET_READONLY_RPC_URL: "https://example.invalid" }), registry, market, assetInfo, autoTimers: false, compileDelayMs: 0 });
  afterAll(() => a.runs.shutdown());
  it("separates isMock/priceIsReal from addressVerified", async () => {
    const tok = (await (await a.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m33-http-user-000001" }) })).json()).accessToken;
    const items = (await (await a.app.request("/v1/markets?limit=50", { headers: { authorization: `Bearer ${tok}` } })).json()).items as any[];
    const by = (s: string) => items.find((x) => x.symbol === s);
    for (const x of items) Market.parse(x);
    for (const s of ["NVDA", "AAPL", "TSLA", "SPY", "WETH"]) {
      const x = by(s); expect(x).toMatchObject({ priceSource: "chainlink_mainnet_readonly", isMock: false, priceIsReal: true, priceVerifiedChainId: 4663, addressVerified: true, addressChainId: 4663, addressSource: expect.stringMatching(/^https:\/\/(api|docs)\.robinhood\.com/) });
      expect(x.tokenAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(by("JUP")).toMatchObject({ priceSource: "jupiter_readonly", isMock: false, priceIsReal: true, priceVerifiedChainId: null, priceVerifiedNetwork: "solana", addressVerified: true });
    expect(items.find((x) => x.id === "hl:perp:SOL")).toMatchObject({ isMock: true, priceIsReal: false, addressVerified: null, tokenAddress: null });
    expect(by("FEDCUT")).toMatchObject({ isMock: true, addressVerified: null });
  });
});
