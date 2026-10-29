import { describe, expect, it } from "vitest";
import { JupiterPrice } from "../../src/venues/jupiter";
import { ReadonlyMarket } from "../../src/venues/readonly-market";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";
import { Verified } from "../../src/verify/loader";

const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
describe("M3.3 verified assets", () => {
  const v = Verified.load("config/verified/4663-readonly.json");
  it("4663 token addresses come only from the verified registry, with source", () => {
    expect(v.tokenAddress("NVDA")).toEqual({ address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", source: "https://api.robinhood.com/rhj/assets" });
    expect(v.tokenAddress("WETH")?.address).toBe("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
    for (const s of ["AAPL", "TSLA", "SPY"]) expect(v.tokenAddress(s)?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(v.tokenAddress("BTC")).toBeNull(); expect(v.tokenAddress("NOPE")).toBeNull();
    expect(v.jupiter()?.mint).toBe(MINT);
  });
});
describe("M3.3 JupiterPrice", () => {
  it("current price only; stale/past = null; bad payload fails closed", async () => {
    const j = new JupiterPrice(MINT, "https://x.invalid/price/v3", async () => ({ [MINT]: { usdPrice: 0.27 } }));
    expect(j.price(1_000)).toBeNull(); await j.refresh(1_000_000);
    expect(j.price(1_000_000 + 60_000)).toEqual({ value: 0.27, observedAt: 1_000_000, source: "jupiter_readonly" });
    expect(j.price(1_000_000 - 86_400_000)).toBeNull(); expect(j.price(1_000_000 + 600_000)).toBeNull();
    const bad = new JupiterPrice(MINT, "u", async () => ({})); await expect(bad.refresh()).rejects.toThrow(); expect(bad.price(Date.now())).toBeNull();
  });
  it("ReadonlyMarket: JUP uses Jupiter, no bars, coverage none", async () => {
    const reg = new Registry(MOCK_INSTRUMENTS); const jup = MOCK_INSTRUMENTS.find((m) => m.symbol === "JUP")!.id;
    const j = new JupiterPrice(MINT, "u", async () => ({ [MINT]: { usdPrice: 0.3 } })); const now = Date.now(); await j.refresh(now);
    const m = new ReadonlyMarket(reg, {} as any, () => false, () => 86_400, 600, j);
    expect(m.price(jup, now)?.source).toBe("jupiter_readonly"); expect(m.bars(jup, 3_600_000, now, 20)).toBeNull();
    expect(m.coverage(jup, now - 86_400_000, now)[0].source).toBe("none");
    expect(m.price("hl:perp:SOL", now)?.source).toMatch(/^mock/);
    const nojup = new ReadonlyMarket(reg, {} as any, () => false); expect(nojup.price(jup, now)?.source).toMatch(/^mock/);
  });
});
