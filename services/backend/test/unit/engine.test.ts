import { describe, expect, it } from "vitest";
import { evalExpr, initState, step } from "../../src/engine/engine";
import type { Snapshot } from "../../src/engine/snapshot";
import { btcStrategy } from "../helpers";
const snap = (v: number | null, stale = false): Snapshot => ({ btc: { fields: { value: v }, observedAt: 0, source: "t", stale } });
describe("engine (pure)", () => {
  it("Kleene logic: unknown never fires", () => {
    const p = new Set<string>();
    expect(evalExpr({ op: "gt", left: { ref: "btc.value" }, right: { lit: 1 } } as any, snap(null), {}, p)).toBeNull();
    expect(evalExpr({ op: "or", args: [{ op: "gt", left: { ref: "btc.value" }, right: { lit: 1 } }, { op: "lt", left: { lit: 1 }, right: { lit: 2 } }] } as any, snap(null), {}, p)).toBe(true);
    expect(evalExpr({ op: "and", args: [{ op: "gt", left: { ref: "btc.value" }, right: { lit: 1 } }, { op: "lt", left: { lit: 2 }, right: { lit: 1 } }] } as any, snap(null), {}, p)).toBe(false);
    expect(evalExpr({ op: "gt", left: { ref: "btc.value" }, right: { lit: 1 } } as any, snap(5, true), {}, p)).toBeNull();
  });
  it("fires once with idempotency key; maxFires respected", () => {
    const s = btcStrategy(); let st = initState(s);
    let r = step(s, st, snap(99_000), 0); expect(r.intents).toHaveLength(0); st = r.state;
    r = step(s, st, snap(101_000), 1000); expect(r.intents.map((i) => i.idempotencyKey)).toEqual(["t1:1:a1"]); st = r.state;
    r = step(s, st, snap(102_000), 2000); expect(r.intents).toHaveLength(0);
  });
  it("forMinutes requires continuous hold", () => {
    const s = btcStrategy({ triggers: [{ id: "t1", forMinutes: 2, cooldownMinutes: 0, maxFires: 1, when: { op: "gt", left: { ref: "btc.value" }, right: { lit: 100000 } } }] });
    let st = initState(s);
    let r = step(s, st, snap(101_000), 0); expect(r.events.map((e) => e.type)).toContain("trigger_met"); st = r.state;
    r = step(s, st, snap(99_000), 60_000); st = r.state; // breaks
    r = step(s, st, snap(101_000), 120_000); st = r.state; expect(r.intents).toHaveLength(0);
    r = step(s, st, snap(101_000), 240_001); expect(r.intents).toHaveLength(1);
  });
  it("crosses_above uses previous cycle", () => {
    const s = btcStrategy({ triggers: [{ id: "t1", cooldownMinutes: 0, maxFires: null, when: { op: "crosses_above", left: { ref: "btc.value" }, right: { lit: 100000 } } }] });
    let st = initState(s);
    let r = step(s, st, snap(101_000), 0); expect(r.intents).toHaveLength(0); st = r.state; // no prev
    r = step(s, st, snap(99_000), 1); st = r.state;
    r = step(s, st, snap(101_000), 2); expect(r.intents).toHaveLength(1); st = r.state;
    r = step(s, st, snap(102_000), 3); expect(r.intents).toHaveLength(0);
  });
  it("blocked state emits nothing", () => {
    const s = btcStrategy(); const r = step(s, initState(s), snap(101_000), 0, { blocked: true }); expect(r.intents).toHaveLength(0);
  });
  it("is pure (does not mutate input state)", () => {
    const s = btcStrategy(); const st = initState(s); const copy = JSON.stringify(st); step(s, st, snap(101_000), 0); expect(JSON.stringify(st)).toBe(copy);
  });
});
