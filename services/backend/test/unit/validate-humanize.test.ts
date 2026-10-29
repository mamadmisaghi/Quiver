import { describe, expect, it } from "vitest";
import { humanize } from "../../src/engine/humanize";
import { hasErrors, validateStrategy } from "../../src/engine/validate";
import { btcStrategy, env, fixtureStrategy } from "../helpers";
const { registry } = env();
describe("validate", () => {
  it("fixture is valid when Stock Tokens allowed", () => { expect(hasErrors(validateStrategy(fixtureStrategy(), { registry, stockTokensAllowed: true }).issues)).toBe(false); });
  it("geo blocks Stock Tokens", () => { expect(validateStrategy(fixtureStrategy(), { registry, stockTokensAllowed: false }).issues.some((i) => i.code === "geo_restricted")).toBe(true); });
  it("unknown instrument rejected", () => {
    const s: any = btcStrategy(); s.actions[0].instrument = "hl:perp:NOPE";
    expect(hasErrors(validateStrategy(s, { registry, stockTokensAllowed: true }).issues)).toBe(true);
  });
  it("unknown ref rejected", () => {
    const s: any = btcStrategy(); s.triggers[0].when.left = { ref: "ghost.value" };
    expect(hasErrors(validateStrategy(s, { registry, stockTokensAllowed: true }).issues)).toBe(true);
  });
  it("cannot trade Polymarket", () => {
    const s: any = btcStrategy(); s.actions[0].instrument = "pm:outcome:fed-cut-december:YES"; s.actions[0].side = "buy"; s.actions[0].leverage = 1;
    expect(hasErrors(validateStrategy(s, { registry, stockTokensAllowed: true }).issues)).toBe(true);
  });
  it("garbage input returns issues, not a throw", () => { expect(validateStrategy({ nope: 1 }, { registry, stockTokensAllowed: true }).strategy).toBeNull(); });
});
describe("humanize", () => {
  it("is deterministic and mentions instruments", () => {
    const a = humanize(fixtureStrategy(), registry), b = humanize(fixtureStrategy(), registry);
    expect(a).toEqual(b); expect(JSON.stringify(a)).toMatch(/NVDA/); expect(JSON.stringify(a)).toMatch(/SOL/);
  });
});
