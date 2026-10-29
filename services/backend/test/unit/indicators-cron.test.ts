import { describe, expect, it } from "vitest";
import { cronMatches, parseCron } from "../../src/engine/cron";
import { ema, pctChange, rsi, sma } from "../../src/engine/indicators";
describe("indicators", () => {
  it("sma", () => { expect(sma([1, 2, 3, 4], 2)).toBe(3.5); expect(sma([1], 2)).toBeNull(); });
  it("ema converges to constant", () => { expect(ema(Array(50).fill(7), 10)).toBeCloseTo(7); });
  it("rsi 100 on monotonic rise", () => { expect(rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14)).toBeCloseTo(100); });
  it("pct change", () => { expect(pctChange([100, 110], 1)).toBeCloseTo(10); });
});
describe("cron", () => {
  it("rejects bad cron", () => { expect(() => parseCron("* * *")).toThrow(); });
  it("matches 9:30 New York on weekdays", () => {
    const t = Date.parse("2026-10-27T13:30:00Z"); // 09:30 EDT Tue
    expect(cronMatches("30 9 * * 1-5", "America/New_York", t)).toBe(true);
    expect(cronMatches("30 9 * * 1-5", "America/New_York", t + 60_000)).toBe(false);
    expect(cronMatches("30 9 * * 1-5", "America/New_York", Date.parse("2026-10-25T13:30:00Z"))).toBe(false); // Sunday
  });
});
