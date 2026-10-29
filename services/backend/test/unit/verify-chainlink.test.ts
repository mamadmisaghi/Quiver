import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { Verified, UnverifiedError, testnetExecutionStatus } from "../../src/verify/loader";
import { VerifiedFile } from "../../src/verify/schema";
import { ChainlinkReader, priceAt, SOURCE, type ReadClient } from "../../src/venues/chainlink";
import { ReadonlyMarket } from "../../src/venues/readonly-market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";

const CODE = "0x6080604052" as Hex; const HASH = keccak256(CODE);
const PROXY = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-10-27T10:00:00Z");
const file = (over: Partial<{ hash: string }> = {}) => new Verified(VerifiedFile.parse({
  chainId: 4663, network: "t", generatedAt: new Date(NOW).toISOString(), rpc: "https://x.test",
  items: [{ id: "V1", title: "x", status: "fail", value: null, sourceUrl: null, checkedAt: new Date(NOW).toISOString(), method: "m", bytecodeHash: null, note: null },
          { id: "ok", title: "x", status: "pass", value: "0xabc", sourceUrl: null, checkedAt: new Date(NOW).toISOString(), method: "m", bytecodeHash: null, note: null }],
  feeds: [{ symbol: "NVDA", name: "Robinhood NVDA / USD", proxy: PROXY, chainId: 4663, decimals: 8, description: "NVDA / USD", heartbeatSec: 86400,
    bytecodeHash: over.hash ?? HASH, sourceUrl: "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json", checkedAt: new Date(NOW).toISOString(), lastAnswer: 1, lastUpdatedAt: null, usage: "mainnet-readonly" }],
}));
// fake feed: rounds every hour for 48h, phase 1
function fakeClient(opts: { stale?: boolean; code?: Hex } = {}): ReadClient & { calls: number } {
  const phase = 1n << 64n; const last = 48n;
  const at = (i: bigint) => BigInt(Math.floor((NOW - (opts.stale ? 3 * 86_400_000 : 0) - Number(last - i) * 3_600_000) / 1000));
  const round = (i: bigint) => [phase | i, (200n + i) * 10n ** 8n, at(i), at(i), phase | i] as const;
  const c = { calls: 0,
    async getCode() { return opts.code ?? CODE; },
    async readContract(a: { functionName: string; args?: readonly unknown[] }) { c.calls++;
      if (a.functionName === "latestRoundData") return round(last);
      if (a.functionName === "getRoundData") { const id = (a.args![0] as bigint) & ((1n << 64n) - 1n); if (id < 1n) throw new Error("No data"); return round(id); }
      throw new Error("unexpected " + a.functionName); } };
  return c as never;
}

describe("verified loader (fail closed)", () => {
  it("missing/invalid file → nothing usable", () => {
    const v = Verified.load("config/verified/does-not-exist.json");
    expect(v.error).toMatch(/missing/); expect(v.usable("V1")).toBe(false);
    expect(() => v.requireFeed("NVDA")).toThrow(UnverifiedError);
  });
  it("only status=pass values are returned", () => {
    const v = file();
    expect(v.require("ok")).toBe("0xabc");
    expect(() => v.require("V1")).toThrow(/not verified \(fail\)/);
    expect(() => v.require("nope")).toThrow(/absent/);
  });
  it("committed 46630.json parses and keeps testnet execution blocked", () => {
    const v = Verified.load("config/verified/46630.json");
    expect(v.error).toBeNull();
    for (const id of ["V1","V2","V3","V4","V5","V6","V7","V8","V9","V10","V11"]) expect(v.item(id)).toBeTruthy();
    const g = testnetExecutionStatus(v);
    expect(g.enabled).toBe(false); expect(g.reason).toMatch(/no verified DEX/);
  });
  it("committed 4663-readonly.json feeds all carry source URL, check date, bytecode hash", () => {
    const v = Verified.load("config/verified/4663-readonly.json");
    expect(v.error).toBeNull();
    expect(v.file!.feeds.length).toBeGreaterThan(0);
    for (const f of v.file!.feeds) { expect(f.sourceUrl).toMatch(/reference-data-directory/); expect(f.bytecodeHash).toMatch(/^0x[0-9a-f]{64}$/); expect(f.usage).toBe("mainnet-readonly"); }
  });
});

describe("ChainlinkReader", () => {
  it("reads latest with 8 decimals and labels the source", async () => {
    const r = new ChainlinkReader(fakeClient(), file(), () => NOW);
    const p = await r.latest("NVDA");
    expect(p).toEqual({ value: 248, observedAt: NOW, source: SOURCE });
  });
  it("unverified symbol throws (fail closed)", async () => {
    await expect(new ChainlinkReader(fakeClient(), file(), () => NOW).latest("AAPL")).rejects.toThrow(UnverifiedError);
  });
  it("bytecode hash mismatch throws", async () => {
    await expect(new ChainlinkReader(fakeClient({ code: "0xdead" }), file(), () => NOW).latest("NVDA")).rejects.toThrow(/bytecode/);
  });
  it("stale beyond heartbeat+grace → null", async () => {
    expect(await new ChainlinkReader(fakeClient({ stale: true }), file(), () => NOW).latest("NVDA")).toBeNull();
  });
  it("history walks rounds back within phase, ascending, no look-ahead", async () => {
    const r = new ChainlinkReader(fakeClient(), file(), () => NOW);
    const h = await r.history("NVDA", NOW - 10 * 3_600_000);
    expect(h.length).toBe(11); expect(h[0].updatedAt).toBeLessThan(h[h.length - 1].updatedAt);
    expect(priceAt(h, NOW - 1)).toBe(247); expect(priceAt(h, NOW)).toBe(248); expect(priceAt(h, 0)).toBeNull();
  });
});

describe("ReadonlyMarket", () => {
  const reg = new Registry(MOCK_INSTRUMENTS); const nvda = reg.bySymbol("NVDA", "robinhood")!; const aapl = reg.bySymbol("AAPL", "robinhood")!;
  it("prices mapped+verified instruments from Chainlink, unverified mapped ones fail closed, others stay mock", async () => {
    const v = file();
    const m = new ReadonlyMarket(reg, new ChainlinkReader(fakeClient(), v, () => NOW), (s) => !!v.feed(s));
    const r = await m.refresh(2 * 86_400_000, NOW);
    expect(r.errors).toEqual([]);
    expect(m.price(nvda.id, NOW)?.source).toBe(SOURCE);
    expect(m.price(aapl.id, NOW)).toBeNull(); // no verified feed → no synthetic fallback
    expect(m.price("hl:perp:BTC", NOW)?.source).toBe("mock_hyperliquid");
    const b = m.bars(nvda.id, 3_600_000, NOW, 5)!; expect(b).toHaveLength(5); expect(b[4].c).toBe(247);
  });
  it("feed read error → instrument returns null, not mock", async () => {
    const v = file({ hash: "0x" + "00".repeat(32) });
    const m = new ReadonlyMarket(reg, new ChainlinkReader(fakeClient(), v, () => NOW), (s) => !!v.feed(s));
    const r = await m.refresh(86_400_000, NOW);
    expect(r.errors[0]).toMatch(/bytecode/); expect(m.price(nvda.id, NOW)).toBeNull();
  });
});
