import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { MemStore } from "../../src/store";
import { FilePersistence, installPersistGuards, nodePersistFs, PersistError, type PersistFs } from "../../src/persist";

const err = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });
const dir = () => mkdtempSync(join(tmpdir(), "quiver-persist-"));
/** Real fs, but the first `n` calls of `op` throw `code`. */
function flaky(op: keyof PersistFs, code: string, n: number) {
  const calls: Record<string, number> = {};
  const fs: PersistFs = { ...nodePersistFs };
  for (const k of Object.keys(nodePersistFs) as (keyof PersistFs)[]) {
    fs[k] = (async (...a: [string, string]) => { calls[k] = (calls[k] ?? 0) + 1; if (k === op && calls[k] <= n) throw err(code); return (nodePersistFs[k] as any)(...a); }) as any;
  }
  return { fs, calls };
}
const mk = (fs: PersistFs, path: string, logs: any[] = []) => {
  const store = new MemStore(); store.audit.push({ marker: "hello" } as any);
  const delays: number[] = [];
  const p = new FilePersistence(store, path, { fs, sleep: async (ms) => { delays.push(ms); }, log: (r) => logs.push(r) });
  return { store, p, delays, logs };
};

describe("dev persistence: crash-proof saves (M3.6.2)", () => {
  it("retries EPERM on rename with backoff, then saves", async () => {
    const path = join(dir(), "state.json"); const { fs, calls } = flaky("rename", "EPERM", 3);
    const { p, delays } = mk(fs, path); p.touch();
    expect(await p.flush()).toBe(true);
    expect(calls.rename).toBe(4); expect(delays).toEqual([50, 100, 200]); expect(p.stats.retries).toBe(3);
    expect(readFileSync(path, "utf8")).toContain("hello"); expect(existsSync(`${path}.tmp`)).toBe(false);
  });
  it("retries EBUSY on the temp write", async () => {
    const path = join(dir(), "state.json"); const { fs, calls } = flaky("writeDurable", "EBUSY", 2);
    const { p } = mk(fs, path); p.touch();
    expect(await p.flush()).toBe(true); expect(calls.writeDurable).toBe(3); expect(existsSync(path)).toBe(true);
  });
  it("gives up after 5 attempts without throwing, logs with a counter, keeps state dirty, and saves on the next try", async () => {
    const path = join(dir(), "state.json"); const { fs, calls } = flaky("rename", "EPERM", 5);
    const { p, delays, logs } = mk(fs, path);
    let unhandled = 0; const h = () => { unhandled++; }; process.on("unhandledRejection", h);
    p.touch();
    await expect(p.flush()).resolves.toBe(false);
    expect(calls.rename).toBe(5); expect(delays).toEqual([50, 100, 200, 400]);
    expect(p.stats).toMatchObject({ failures: 1, consecutiveFailures: 1, saves: 0 });
    expect(logs.at(-1)).toMatchObject({ level: "error", code: "EPERM", failures: 1 });
    expect(existsSync(path)).toBe(false);
    expect(await p.flush()).toBe(true); // still dirty -> next save retries and lands
    expect(readFileSync(path, "utf8")).toContain("hello"); expect(p.stats.consecutiveFailures).toBe(0);
    await new Promise((r) => setTimeout(r, 10)); process.off("unhandledRejection", h); expect(unhandled).toBe(0);
  });
  it("backoff is capped at 1s", async () => {
    const path = join(dir(), "s.json"); const { fs } = flaky("rename", "EACCES", 99);
    const store = new MemStore(); const delays: number[] = [];
    const p = new FilePersistence(store, path, { fs, attempts: 7, sleep: async (ms) => { delays.push(ms); }, log: () => {} }); p.touch();
    await p.flush(); expect(delays).toEqual([50, 100, 200, 400, 800, 1000]);
  });
  it("non-transient errors are not retried but never throw", async () => {
    const path = join(dir(), "s.json"); const { fs, calls } = flaky("writeDurable", "ENOSPC", 1);
    const { p } = mk(fs, path); p.touch();
    expect(await p.flush()).toBe(false); expect(calls.writeDurable).toBe(1); expect(await p.flush()).toBe(true);
  });
  it("coalesces concurrent saves into one in-flight write plus one follow-up", async () => {
    const path = join(dir(), "s.json"); const { fs, calls } = flaky("rename", "EPERM", 0);
    const { p, store } = mk(fs, path); p.touch();
    const a = p.flush(); store.audit.push({ marker: "later" } as any); p.touch(); const b = p.flush(); p.touch(); const c = p.flush();
    expect(b).toBe(a); expect(c).toBe(a);
    expect(await Promise.all([a, b, c])).toEqual([true, true, true]);
    expect(calls.writeDurable).toBe(2); expect(readFileSync(path, "utf8")).toContain("later");
  });
  it("load tolerates a leftover temp file (recovers from it if main is missing, otherwise ignores and removes it)", () => {
    const d = dir(); const path = join(d, "state.json");
    const src = new MemStore(); src.audit.push({ marker: "fromtmp" } as any);
    const good = new FilePersistence(src, path); (good as any).dirty = true; good.flushSync();
    const json = readFileSync(path, "utf8");
    // main missing, complete temp left behind
    const d2 = dir(); const p2 = join(d2, "state.json"); writeFileSync(`${p2}.tmp`, json);
    const s2 = new MemStore(); expect(new FilePersistence(s2, p2, { log: () => {} }).load()).toBe(true);
    expect(JSON.stringify(s2.audit)).toContain("fromtmp"); expect(existsSync(`${p2}.tmp`)).toBe(false);
    // main present, truncated temp left behind
    writeFileSync(`${path}.tmp`, json.slice(0, 20));
    const s3 = new MemStore(); expect(new FilePersistence(s3, path, { log: () => {} }).load()).toBe(true);
    expect(JSON.stringify(s3.audit)).toContain("fromtmp"); expect(existsSync(`${path}.tmp`)).toBe(false);
  });
  it("load returns false (not throw) on garbage", () => {
    const path = join(dir(), "state.json"); writeFileSync(path, "{nope");
    expect(new FilePersistence(new MemStore(), path, { log: () => {} }).load()).toBe(false);
  });
  it("touch() debounced save failing does not crash the process", async () => {
    const path = join(dir(), "s.json"); const { fs } = flaky("rename", "EPERM", 99);
    const store = new MemStore(); const logs: any[] = [];
    const p = new FilePersistence(store, path, { fs, debounceMs: 1, attempts: 2, sleep: async () => {}, log: (r) => logs.push(r) });
    let unhandled = 0; const h = () => { unhandled++; }; process.on("unhandledRejection", h);
    p.touch(); await new Promise((r) => setTimeout(r, 30));
    process.off("unhandledRejection", h); expect(unhandled).toBe(0); expect(p.stats.failures).toBe(1); expect(logs.at(-1).level).toBe("error");
  });
  it("process guard logs persist rejections and rethrows others", () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process; const logs: any[] = [];
    const off = installPersistGuards((r) => logs.push(r), proc);
    expect(() => proc.emit("unhandledRejection", new PersistError("boom"))).not.toThrow();
    expect(logs[0]).toMatchObject({ level: "error", error: "boom" });
    expect(() => proc.emit("unhandledRejection", new Error("real bug"))).toThrow("real bug");
    off();
  });
});

describe("dev persistence: newer complete temp file wins (M3.7)", () => {
  const snap = (savedAt: string | undefined, label: string) => JSON.stringify({ v: 1, ...(savedAt ? { savedAt } : {}), audit: [{ marker: label }], users: [], usersByLabel: [], strategies: [], runs: [], backtests: [], sessionKeys: [] });
  const load = (main: string | null, tmp: string | null) => {
    const path = join(dir(), "state.json"); if (main !== null) writeFileSync(path, main); if (tmp !== null) writeFileSync(path + ".tmp", tmp);
    const store = new MemStore(); const logs: any[] = []; const p = new FilePersistence(store, path, { log: (r) => logs.push(r) });
    const ok = p.load(); return { ok, marker: (store.audit[0] as any)?.marker, from: p.loadedFrom, path, logs };
  };
  it("prefers a valid .tmp whose savedAt is newer than a valid main file, and promotes it", () => {
    const r = load(snap("2026-10-28T05:00:00.000Z", "old"), snap("2026-10-28T05:00:02.000Z", "new"));
    expect([r.ok, r.marker, r.from]).toEqual([true, "new", "tmp"]);
    expect(existsSync(r.path + ".tmp")).toBe(false); expect(JSON.parse(readFileSync(r.path, "utf8")).audit[0].marker).toBe("new");
    expect(r.logs.some((l) => /newer complete temp/.test(l.msg))).toBe(true);
  });
  it("keeps the main file when the .tmp is older or equal", () => {
    expect(load(snap("2026-10-28T05:00:02.000Z", "main"), snap("2026-10-28T05:00:01.000Z", "tmp")).marker).toBe("main");
    expect(load(snap("2026-10-28T05:00:02.000Z", "main"), snap("2026-10-28T05:00:02.000Z", "tmp")).marker).toBe("main");
  });
  it("main without savedAt counts as oldest; a .tmp without savedAt never beats a dated main", () => {
    expect(load(snap(undefined, "main"), snap("2026-10-28T05:00:00.000Z", "tmp")).marker).toBe("tmp");
    expect(load(snap("2026-10-28T05:00:00.000Z", "main"), snap(undefined, "tmp")).marker).toBe("main");
  });
  it("ignores a structurally invalid .tmp even if newer", () => {
    const bad = JSON.stringify({ v: 1, savedAt: "2030-01-01T00:00:00.000Z", users: "nope" });
    expect(load(snap("2026-10-28T05:00:00.000Z", "main"), bad)).toMatchObject({ ok: true, marker: "main", from: "main" });
  });
  it("snapshot savedAt is strictly increasing", async () => {
    const { snapshot } = await import("../../src/persist"); const s = new MemStore();
    const a = Date.parse(snapshot(s).savedAt as string), b = Date.parse(snapshot(s).savedAt as string); expect(b).toBeGreaterThan(a);
  });
});
