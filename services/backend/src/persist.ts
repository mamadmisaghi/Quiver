import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { dirname } from "node:path";
import type { MemStore } from "./store";

/**
 * DEV-ONLY file persistence for MemStore (mock mode). A JSON snapshot at `.data/dev-store.json` (gitignored),
 * so `tsx watch` restarts keep users, strategies, runs, backtests and session keys. Not a database: single
 * process, last write wins, debounced. Off in tests and outside mock mode. Never stores secrets beyond
 * the dev store contents (refresh tokens are dropped; users sign in again after a restart only if expired).
 */
const MAPS = ["users", "usersByLabel", "strategies", "runs", "backtests", "sessionKeys", "autopilot", "cardShares", "instructs", "replayShares", "userSecrets"] as const;
const VERSION = 1;

/** M3.7: savedAt is strictly increasing within a process (two saves in the same ms still order correctly on load). */
let lastSavedAt = 0;
const nextSavedAt = () => { lastSavedAt = Math.max(Date.now(), lastSavedAt + 1); return new Date(lastSavedAt).toISOString(); };
export function snapshot(store: MemStore) {
  const out: Record<string, unknown> = { v: VERSION, savedAt: nextSavedAt(), audit: store.audit.slice(-2000) };
  for (const k of MAPS) out[k] = [...(store[k] as Map<string, any>).entries()].map(([id, row]) => [id, k === "backtests" ? { ...row, listeners: undefined } : row]);
  return out;
}

/** M3.7: a snapshot is valid when it has the current version and every map is an array of [id, row] pairs. */
export function isValidSnapshot(data: any): boolean {
  if (!data || typeof data !== "object" || data.v !== VERSION) return false;
  return MAPS.every((k) => data[k] === undefined || (Array.isArray(data[k]) && data[k].every((e: unknown) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string")));
}
/** M3.7: savedAt as ms (NaN-safe): a snapshot without a parseable savedAt counts as the oldest possible. */
export const savedAtMs = (data: any): number => { const t = typeof data?.savedAt === "string" ? Date.parse(data.savedAt) : NaN; return Number.isFinite(t) ? t : -Infinity; };

export function restore(store: MemStore, data: any): boolean {
  if (!isValidSnapshot(data)) return false;
  for (const k of MAPS) {
    const m = store[k] as Map<string, any>; m.clear();
    for (const [id, row] of (data[k] ?? []) as [string, any][]) m.set(id, k === "backtests" ? { ...row, listeners: new Set() } : row);
  }
  store.audit.splice(0, store.audit.length, ...((data.audit ?? []) as MemStore["audit"]));
  return true;
}

/** Error codes that mean "file briefly locked" (Windows AV/indexer/editor): retried with backoff. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
export const isTransientFsError = (e: unknown) => TRANSIENT.has((e as NodeJS.ErrnoException)?.code ?? "");

/** Marks errors that originate in dev persistence so the process-level guard can log (not crash) on them. */
export class PersistError extends Error {
  readonly persist = true;
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = "PersistError"; }
}
export const isPersistError = (e: unknown): e is PersistError => !!e && typeof e === "object" && (e as { persist?: unknown }).persist === true;

/** The fs surface persistence uses (injectable so tests can simulate EPERM/EBUSY without touching the real disk). */
export interface PersistFs {
  mkdir(p: string): Promise<void>;
  /** write + fsync + close */
  writeDurable(p: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(p: string): Promise<void>;
}
export const nodePersistFs: PersistFs = {
  mkdir: async (p) => { await fsp.mkdir(p, { recursive: true }); },
  writeDurable: async (p, data) => { const fh = await fsp.open(p, "w"); try { await fh.writeFile(data, "utf8"); await fh.sync(); } finally { await fh.close(); } },
  rename: (a, b) => fsp.rename(a, b),
  unlink: (p) => fsp.unlink(p),
};

export interface PersistOptions {
  debounceMs?: number; fs?: PersistFs; attempts?: number; baseDelayMs?: number; maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>; log?: (rec: Record<string, unknown>) => void;
}
const defaultLog = (rec: Record<string, unknown>) => console.error(JSON.stringify(rec));
const sleepSync = (ms: number) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no-op */ } };

/** Backoff for attempt i (0-based): base * 2^i capped at max (50, 100, 200, 400, 800 → 1000). */
export const backoffMs = (i: number, base = 50, max = 1000) => Math.min(max, base * 2 ** i);

export class FilePersistence {
  private t: NodeJS.Timeout | null = null; private dirty = false;
  private inflight: Promise<boolean> | null = null; private again = false;
  readonly stats = { saves: 0, failures: 0, consecutiveFailures: 0, retries: 0, lastError: null as string | null };
  private fs: PersistFs; private attempts: number; private base: number; private max: number; private debounceMs: number;
  private sleep: (ms: number) => Promise<void>; private log: (rec: Record<string, unknown>) => void;
  constructor(private store: MemStore, readonly path: string, opts: PersistOptions | number = {}) {
    const o = typeof opts === "number" ? { debounceMs: opts } : opts;
    this.debounceMs = o.debounceMs ?? 500; this.fs = o.fs ?? nodePersistFs; this.attempts = o.attempts ?? 5;
    this.base = o.baseDelayMs ?? 50; this.max = o.maxDelayMs ?? 1000; this.log = o.log ?? defaultLog;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => { const h = setTimeout(r, ms); h.unref?.(); }));
  }
  get tmpPath() { return `${this.path}.tmp`; }
  /** M3.7: which file the last load() restored from (null = nothing restored). */
  loadedFrom: "main" | "tmp" | null = null;

  /** Load the snapshot. Tolerates a locked file (sync retries with backoff) and a leftover/partial temp file. */
  load(): boolean {
    const tmp = this.tmpPath;
    const tryRead = (p: string): any => {
      for (let i = 0; i < this.attempts; i++) {
        try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) {
          if (isTransientFsError(e) && i < this.attempts - 1) { sleepSync(backoffMs(i, this.base, this.max)); continue; }
          if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") this.log({ level: "warn", msg: "dev persistence: load failed", path: p, error: String((e as Error)?.message ?? e) });
          return undefined;
        }
      }
      return undefined;
    };
    try {
      const main = existsSync(this.path) ? tryRead(this.path) : undefined;
      const temp = existsSync(tmp) ? tryRead(tmp) : undefined;
      const mainOk = isValidSnapshot(main), tmpOk = isValidSnapshot(temp);
      // M3.7: a crash between write+fsync and rename leaves a COMPLETE temp file that is newer than the main file.
      // Prefer whichever valid snapshot has the newer savedAt; the temp file wins only when strictly newer (or the main file is unusable).
      const useTmp = tmpOk && (!mainOk || savedAtMs(temp) > savedAtMs(main));
      let ok = false;
      if (useTmp) { ok = restore(this.store, temp); if (ok) { this.loadedFrom = "tmp"; this.log({ level: "warn", msg: mainOk ? "dev persistence: recovered newer complete temp file" : "dev persistence: recovered from leftover temp file", path: tmp, savedAt: temp.savedAt ?? null, mainSavedAt: mainOk ? main.savedAt ?? null : null }); } }
      if (!ok && mainOk) { ok = restore(this.store, main); if (ok) this.loadedFrom = "main"; }
      if (ok && useTmp) { try { renameSync(tmp, this.path); } catch { /* keep the temp; overwritten on next save */ } }
      if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* stale temp; overwritten on next save */ } }
      return ok;
    } catch (e) { this.log({ level: "warn", msg: "dev persistence: load failed", error: String((e as Error)?.message ?? e) }); return false; }
  }

  /** Mark dirty; writes at most once per debounceMs. Never throws. */
  touch() {
    this.dirty = true; if (this.t) return;
    this.t = setTimeout(() => { this.t = null; void this.flush(); }, this.debounceMs); this.t.unref?.();
  }

  /**
   * Save now if dirty. Concurrent calls coalesce: while a save is in flight, further calls share one follow-up
   * save of the latest state. Resolves true on success, false on failure; never rejects. On failure the
   * in-memory state is kept and the store stays dirty, so the next touch/flush retries.
   */
  flush(): Promise<boolean> {
    if (this.inflight) { this.again = true; return this.inflight; }
    if (!this.dirty) return Promise.resolve(true);
    const run = async (): Promise<boolean> => {
      let ok: boolean;
      do { this.again = false; ok = await this.saveOnce(); } while (this.again && this.dirty);
      return ok;
    };
    this.inflight = run().catch((e) => { this.fail(e); return false; }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async saveOnce(): Promise<boolean> {
    this.dirty = false;
    let data: string;
    try { data = JSON.stringify(snapshot(this.store)); } catch (e) { this.dirty = true; this.fail(e); return false; }
    try {
      await this.retry(() => this.fs.mkdir(dirname(this.path)));
      await this.retry(() => this.fs.writeDurable(this.tmpPath, data));
      await this.retry(() => this.fs.rename(this.tmpPath, this.path));
      this.stats.saves++; this.stats.consecutiveFailures = 0; this.stats.lastError = null;
      return true;
    } catch (e) {
      this.dirty = true; this.fail(e);
      try { await this.fs.unlink(this.tmpPath); } catch { /* best effort */ }
      return false;
    }
  }

  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (!isTransientFsError(e) || i >= this.attempts - 1) throw e;
        this.stats.retries++; await this.sleep(backoffMs(i, this.base, this.max));
      }
    }
  }

  private fail(e: unknown) {
    this.stats.failures++; this.stats.consecutiveFailures++; this.stats.lastError = String((e as Error)?.message ?? e);
    try { this.log({ level: "error", msg: "dev persistence: save failed (state kept in memory; will retry on next save)", path: this.path, code: (e as NodeJS.ErrnoException)?.code, error: this.stats.lastError, failures: this.stats.failures, consecutiveFailures: this.stats.consecutiveFailures }); } catch { /* never throw */ }
  }

  /** Synchronous best-effort final save for shutdown (signal handlers can't await). Never throws. */
  flushSync(): boolean {
    if (this.t) { clearTimeout(this.t); this.t = null; }
    if (!this.dirty) return true;
    try {
      const data = JSON.stringify(snapshot(this.store)); const tmp = this.tmpPath;
      const step = (fn: () => void) => { for (let i = 0; ; i++) { try { return fn(); } catch (e) { if (!isTransientFsError(e) || i >= this.attempts - 1) throw e; this.stats.retries++; sleepSync(backoffMs(i, this.base, this.max)); } } };
      step(() => mkdirSync(dirname(this.path), { recursive: true }));
      step(() => { const fd = openSync(tmp, "w"); try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); } });
      step(() => renameSync(tmp, this.path));
      this.dirty = false; this.stats.saves++; this.stats.consecutiveFailures = 0; return true;
    } catch (e) { this.fail(e); return false; }
  }
}

/**
 * Process-level guard: a stray rejection/exception that came from dev persistence is logged, not fatal.
 * Anything else is re-thrown so Node's default crash behaviour is preserved for real bugs.
 */
export function installPersistGuards(log: (rec: Record<string, unknown>) => void = defaultLog, proc: NodeJS.Process = process) {
  const onRejection = (reason: unknown) => {
    if (isPersistError(reason) || isPersistStack(reason)) { log({ level: "error", msg: "dev persistence: unhandled rejection suppressed", error: String((reason as Error)?.message ?? reason) }); return; }
    throw reason;
  };
  proc.on("unhandledRejection", onRejection);
  return () => { proc.off("unhandledRejection", onRejection); };
}
const isPersistStack = (e: unknown) => typeof (e as Error)?.stack === "string" && /persist\.ts/.test((e as Error).stack!) && isTransientFsError(e);

/** Mock-mode-only JWT signing secret kept next to the dev snapshot (gitignored, 0600, never logged). */
export function devSecret(snapshotPath: string, gen: () => string): string {
  const f = `${dirname(snapshotPath)}/dev-jwt-secret`;
  try { const v = readFileSync(f, "utf8").trim(); if (v.length >= 32) return v; } catch { /* create */ }
  mkdirSync(dirname(f), { recursive: true }); const v = gen(); writeFileSync(f, v, { mode: 0o600 }); return v;
}
