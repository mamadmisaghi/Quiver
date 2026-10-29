import { AsyncLocalStorage } from "node:async_hooks";
import { ffmpegRenderer, renderPaths, removeRender } from "../replay/ffmpeg";
import { statSync as _st, readFileSync as _rf } from "node:fs";
import { AutopilotService } from "../autopilot/service";
import * as AP from "../../contracts/src/autopilot";
import { buildReplay } from "../replay/replay";
import type { ApprovalRec } from "../sim/executor";
import { bodyLimit } from "hono/body-limit";
import { redact } from "../lib/redact";
import { dedupe, friendlyIssues } from "../lib/issues";
import type { InstrumentMeta } from "../venues/registry";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { stream, streamSSE } from "hono/streaming";
import { actionTitle as sharedTitle } from "../sim/titles";
import { z } from "zod";
import * as A from "../../contracts/src/api";
import * as WO from "../../contracts/src/writeoff";
import * as SO from "../../contracts/src/social";
import * as RS from "../../contracts/src/replayshare";
import * as SE from "../../contracts/src/secrets";
import { SecretVault } from "../secrets/vault";
import { checkUrlShape, resolvePublic, systemResolver } from "../alerts/ssrf";
import { nodeRpcPost, pinnedTransport } from "../chain/pinned";
import { dims, stubRenderer, type ReplayRenderer } from "../replay/render";
import { checkImage, IMAGE_MAX_BYTES, IMAGE_MAX_PX, IMAGE_MIN_PX } from "../compile/image";
import { HTTP_STATUS, type ErrorCode } from "../../contracts/src/errors";
import { PageQuery, RunId, StrategyId as StrategyIdT } from "../../contracts/src/common";
import { checkRange, BacktestError, earliestFrom, runBacktest, RES_MS } from "../backtest/backtest";
import { compile } from "../compile/index";
import type { Config } from "../config";
import { Warmup, WARMUP_NOTICE, WARMUP_OBJ } from "../warmup";
import { TiingoHistory, TiingoOverlay, tiingoSupports, type TiingoHttp } from "../venues/tiingo";
import { humanize } from "../engine/humanize";
import { hasErrors, validateStrategy } from "../engine/validate";
import { signJwt, verifyJwt, randomToken } from "../lib/auth";
import { iso, systemClock, type Clock } from "../lib/clock";
import { dec, usd } from "../lib/dec";
import { newId } from "../lib/ids";
import { RunManager } from "../runs/manager";
import { MOCK_TARGETS, MockSigner, SessionKeyError, SessionKeyService, type Target } from "../sessionkeys/service";
import { toPriceSource } from "../venues/market";
import type { ValidationIssue } from "../../contracts/src/strategy";
import { devSecret, FilePersistence } from "../persist";
import { MemStore, paginate, type StrategyRow, type User } from "../store";
import type { DurableStorage } from "../storage/postgres";
import { mockAdapters, VenueError, type Adapters } from "../venues/adapters";
import { MockMarket, nyseSession, type MarketData } from "../venues/market";
import { MOCK_INSTRUMENTS, Registry } from "../venues/registry";
import { strategyNodes } from "../engine/nodes";
import { equitySeries } from "../backtest/backtest";
import { SseSubscriber } from "./sse";
import { LANDING_NOTICE, LANDING_PREVIEW_ID, LANDING_SIGNALS, LANDING_TRADES } from "../social/landing";
import { EXAMPLE_SEASON, exampleNotices, pricesPhrase, QUEST_POINTS, QUESTS, SEED_PUBLIC, SKILLS } from "../social/seed";
import * as X from "../../contracts/src/ext";
import * as PB from "../../contracts/src/public";
import * as IN from "../../contracts/src/instruct";
import { applyOps, instructCompile } from "../compile/instruct";
import * as O from "../../contracts/src/ops";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, keccak256, toHex, parseUnits, formatUnits, encodeFunctionData, erc20Abi } from "viem";
import * as TN from "../../contracts/src/testnet";
import { POOL_ABI, ERC20_RO, testPoolState, defaultReader, type PoolReader } from "../testpool";
import * as AL from "../../contracts/src/alerts";
import { AlertService, type Transport } from "../alerts/service";
import { UrlBlocked, type Resolver } from "../alerts/ssrf";
import { telegramAdapter, xAdapter } from "../alerts/channels";
import { channelView } from "../alerts/service";
import { ChainReader, ChainMismatch } from "../chain/reader";
import { Verified as VerifiedReg, testnetExecutionStatus } from "../verify/loader";
import type { ChainStatusRes } from "../../contracts/src/chain";
import * as MK from "../../contracts/src/market";
import * as AU from "../../contracts/src/auth";
import { PrivyVerifier, PrivyUnavailable } from "../auth/privy";
import { verifyMessage } from "viem";
import { isLowS } from "../auth/lowS";

/** M3.3: verified real token address for an instrument (read-only reference), or null. */
export type AssetInfo = (m: InstrumentMeta) => { address: string; chainId: number | null; source: string } | null;
export interface AppOptions { store?: MemStore; durable?: DurableStorage; isDraining?: () => boolean; /** M5.21: background price-history warmup (main.ts); absent = ready. */ warmup?: Warmup; /** M5.18: Tiingo HTTP hook (tests inject mocks); used only when TIINGO_API_KEY is set. */ tiingoHttp?: TiingoHttp; /** M5.23: test-pool reader (tests inject an anvil client + expectChainId 31337); default built from TEST_POOL_RPC_URL, must report 46630. */ testPool?: { reader: PoolReader; expectChainId?: number }; /** M5.7: replay video renderer (default: stub). */ renderer?: ReplayRenderer; /** M5.2: Privy verifier (tests inject); default built from PRIVY_* env. */ privy?: PrivyVerifier; /** M5.0: read-only 46630 reader (tests inject; null = disabled). Default: built when CHAIN_READS_ENABLED. */ chainReader?: ChainReader | null; testnetVerified?: VerifiedReg; assetInfo?: AssetInfo; config: Config; clock?: Clock; market?: MarketData; registry?: Registry; adapters?: Adapters; autoTimers?: boolean; compileDelayMs?: number; /** M4.9.1: stop/flatten bound (tests) */ stopTimeoutMs?: number; /** dev-only JSON snapshot path (mock mode); null/undefined = in-memory only */ persistPath?: string | null; verifiedTargets?: Target[] | null; /** test hook: rate-limit map capacity (default 50k) */ rlMax?: number; /** M3.7: called (after the response) by POST /v1/ops/shutdown; main.ts wires the graceful stop. */ onShutdown?: () => void; /** M4.0 test hooks: DNS resolver + HTTPS transport for webhook alerts */ alertResolver?: Resolver; alertTransport?: Transport; /** M5.13 test hook: pinned JSON-RPC POST for user RPC URLs */ rpcPost?: import("../chain/pinned").RpcPost; /** M5.14 test hooks: chat-channel HTTP + backoff sleep */ channelHttp?: import("../alerts/channels").ChannelHttp; channelSleep?: (ms: number) => Promise<void> }

/** M3.6: tolerated client clock skew for backtest `to` (clamped to server now). */
/** M5.2 */
export const MAX_WALLETS = 5;
export const BACKTEST_MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** M3.6.1: Retry-After fallback for 429s without a natural window (e.g. active-run cap). */
export const DEFAULT_RETRY_AFTER_SEC = 60;
class ApiErr extends Error { constructor(public code: ErrorCode, msg: string, public details?: unknown, public retryAfterSec?: number) { super(msg); } }
type Env = { Variables: { user: User; requestId: string } };

export function createApp(o: AppOptions) {
  const cfg = o.config; const clock = o.clock ?? systemClock;
  const registry = o.registry ?? new Registry(MOCK_INSTRUMENTS);
  const mkt = o.market ?? new MockMarket(registry);
  const adapters = o.adapters ?? mockAdapters(mkt, registry);
  const store = o.store ?? new MemStore();
  // M5.18: optional Tiingo history for stock/ETF instruments; null when the key is unset → current source ("fallback").
  const warmup = o.warmup ?? new Warmup(() => clock.now(), false);
  const tiingo = cfg.TIINGO_API_KEY ? new TiingoHistory({ key: cfg.TIINGO_API_KEY, http: o.tiingoHttp, now: () => clock.now() }) : null;
  const isStock = (id: string) => { const m = registry.get(id); return !!m && (m.assetClass === "equity" || m.assetClass === "etf"); };
  /** Backtest market: Tiingo overlay when every stock/ETF instrument loads; otherwise the current source for all. */
  const backtestMarket = async (st: { signals: any[]; actions: any[] }, from: number, to: number, resMs: number, owner?: string): Promise<{ m: MarketData; dataSource: "tiingo" | "fallback" }> => {
    const ids = new Set<string>(); st.signals.forEach((x) => x.params && "instrument" in x.params && ids.add(x.params.instrument)); st.actions.forEach((a) => ids.add(a.instrument));
    const stocks = [...ids].filter(isStock);
    if (!tiingo || !stocks.length || !tiingoSupports(resMs)) return { m: mkt, dataSource: "fallback" };
    const look = resMs >= 86_400_000 ? 400 * 86_400_000 : 30 * 86_400_000; // warm-up history for indicators
    const series = new Map<string, { tfMs: number; bars: { o: number; h: number; l: number; c: number; t: number }[]; source: string }>();
    for (const id of stocks) {
      const b = await tiingo.bars(registry.get(id)!.symbol, resMs, from - look, to, owner);
      if (!b?.length) return { m: mkt, dataSource: "fallback" };
      series.set(id, { tfMs: resMs, bars: b, source: resMs >= 86_400_000 ? "tiingo_daily" : "tiingo_iex" });
    }
    return { m: new TiingoOverlay(mkt, series), dataSource: "tiingo" };
  };
  const secret = cfg.QUIVR_JWT_SECRET ?? (o.persistPath && cfg.QUIVR_MODE === "mock" ? devSecret(o.persistPath, () => randomToken(48)) : randomToken(48)); // mock: per-boot random, or a gitignored dev file when dev persistence is on (sessions survive restarts)
  const walletLinkOn = !!(cfg.SIWE_ORIGIN ?? (cfg.QUIVR_MODE === "mock" && cfg.SIWE_DEV_LOCALHOST)); // M5.11
  const publicHandle = (h: string) => /^@[A-Za-z0-9][A-Za-z0-9_.-]{1,39}$/.test(h) && !/\d{7,}/.test(h) ? h : "@trader_" + createHmac("sha256", secret).update("public-handle:" + h).digest("hex").slice(0, 8); // M4.9.1 (B3): keyed, so a known email cannot be confirmed
  const blocked = new Set(cfg.GEO_BLOCKED_COUNTRIES.split(","));
  let killSwitch = false;
  const signer = new MockSigner();
  const sk = new SessionKeyService(store, registry, signer, { mode: cfg.QUIVR_MODE, targets: () => (cfg.QUIVR_MODE === "mock" ? MOCK_TARGETS : o.verifiedTargets ?? null), defaults: { perTxUsd: cfg.SK_DEFAULT_PER_TX_USD, dailyUsd: cfg.SK_DEFAULT_DAILY_USD, defaultExpiryHours: cfg.SK_DEFAULT_EXPIRY_HOURS, maxExpiryHours: cfg.SK_MAX_EXPIRY_HOURS }, now: () => clock.now(),
    signingAvailable: !!cfg.ALCHEMY_API_KEY, priceUsd: (id) => mkt.price(id, clock.now())?.value ?? null });
  const alerts = new AlertService({ provider: cfg.ALERTS_PROVIDER, now: () => clock.now(), resolve: o.alertResolver, transport: o.alertTransport, channels: [telegramAdapter(cfg.TELEGRAM_BOT_TOKEN, { http: o.channelHttp, now: () => clock.now(), sleep: o.channelSleep }), xAdapter(cfg.X_ALERTS_TOKEN, { http: o.channelHttp, now: () => clock.now(), sleep: o.channelSleep })] });
  if (o.autoTimers ?? true) { const t = setInterval(() => void alerts.process(), 5000); t.unref?.(); }
  const runs = new RunManager({ stopTimeoutMs: o.stopTimeoutMs, onEvent: (run, ev) => alerts.onRunEvent(run, ev), clock, mkt, adapters, registry, cycleMs: cfg.ENGINE_CYCLE_MS, killSwitch: () => killSwitch, validateEvents: process.env.NODE_ENV !== "production", autoTimers: o.autoTimers ?? true, concurrency: cfg.ENGINE_CONCURRENCY,
    sessionKey: (run) => (run.sessionKeyId ? () => { const r = store.sessionKeys.get(run.sessionKeyId!); if (!r) return null; sk.refresh(r); return { perTxCapUsd: Number(r.policy.perTxCapUsd), dailyCapUsd: Number(r.policy.dailyCapUsd), spentTodayUsd: sk.spentToday(r), status: r.status }; } : undefined),
    onSpend: (run, u) => { if (run.sessionKeyId) { const r = store.sessionKeys.get(run.sessionKeyId); if (r) { sk.spentToday(r); r.spent.usd += u; } } } });  // ---------- dev persistence (mock mode only) ----------
  const persist = o.persistPath && cfg.QUIVR_MODE === "mock" ? new FilePersistence(store, o.persistPath) : null;
  if (o.durable || persist?.load()) {
    if (o.durable) {
      for (const backtest of store.backtests.values()) if (["queued", "running"].includes(backtest.res.status)) {
        backtest.res.status = "failed"; backtest.res.error = "This backtest was interrupted by a server restart. Run it again.";
      }
      for (const share of store.replayShares.values()) if (share.render.status === "rendering" && !share.revokedAt) share.render.status = "queued";
    }
    for (const run of store.runs.values()) {
      if (o.durable) {
        const st = store.strategies.get(run.strategyId)?.versions.find((v) => v.version === run.strategyVersion)?.strategy;
        const u = store.users.get(run.ownerId); const cp = store.runCheckpoints.get(run.id);
        if (run.mode === "paper" && cp && st && u) {
          runs.start(run, st, () => true, { checkpoint: cp, restoreStatus: run.status });
        } else if (run.status !== "stopped") {
          // Never restart a real-money run or silently reset an old run's account.
          run.status = "stopped"; run.stoppedAt = clock.now();
          run.events.push({ v: 1, seq: run.events.length, runId: run.id, mode: run.mode, ts: iso(clock.now()), type: "status", status: "stopped", reason: "Stopped after restart: no compatible paper checkpoint. Start a new paper run." });
        }
        continue;
      }
      if (run.status === "stopped" || run.status === "halted") continue;
      const st = store.strategies.get(run.strategyId)?.versions.find((v) => v.version === run.strategyVersion)?.strategy; const u = store.users.get(run.ownerId);
      if (!st || !u) { run.status = "stopped"; run.stoppedAt = clock.now(); continue; }
      const wasPaused = run.status === "paused"; // M4.2.1: a paused run stays paused across a dev restart
      runs.start(run, st, () => run.mode === "live" ? u.eligibility.stockTokens === "allowed" : true, { paused: wasPaused });
      runs.warn(run.id, "dev_restart", wasPaused ? "Server restarted (dev). Run is still paused; paper positions were reset to starting equity." : "Server restarted (dev). Run resumed; paper positions were reset to starting equity.");
    }
  }
  const persistTimer = persist ? setInterval(() => { if (runs.live.size) persist.touch(); }, 2000) : null; persistTimer?.unref?.();

  // M4.9.1 (B1): reserve an estimate before each AI call (max of LLM_EST_CALL_USD and the largest call seen today); settle with the real cost after.
  // A crashed request may have been billed. Recovered reservations count conservatively as spent.
  for (const row of store.llmDaily.values()) { row.usd += row.reserved; row.reserved = 0; }
  const llmDay = () => {
    const day = today(); let row = store.llmDaily.get(day);
    if (!row) { row = { day, usd: 0, reserved: 0, maxCall: 0 }; store.llmDaily.set(day, row); }
    for (const key of store.llmDaily.keys()) if (key < day && store.llmDaily.size > 7) store.llmDaily.delete(key);
    return row;
  };
  // M4.9.2: conservative reservation + in-flight cap. Every call reserves `llmEst()` before it runs; a reservation is refused
  // when spent + reserved + est would pass the cap (so reserved money never exceeds what is left) or when LLM_MAX_INFLIGHT calls are running.
  const llmPriced = cfg.LLM_PRICE_IN_PER_MTOK != null && cfg.LLM_PRICE_OUT_PER_MTOK != null ? (cfg.LLM_MAX_INPUT_TOKENS * cfg.LLM_PRICE_IN_PER_MTOK + cfg.LLM_MAX_OUTPUT_TOKENS * cfg.LLM_PRICE_OUT_PER_MTOK) / 1e6 : 0;
  let llmInflight = 0; let llmRefusal: "cap" | "busy" | null = null;
  const llmEst = () => Math.max(cfg.LLM_EST_CALL_USD, llmPriced, llmDay().maxCall);
  const llmBudget = { capUsd: cfg.LLM_DAILY_BUDGET_USD, spentToday: () => llmDay().usd + llmDay().reserved,
    add: (u: number) => { const d = llmDay(); d.usd += u; d.maxCall = Math.max(d.maxCall, u); },
    reserve: () => { const d = llmDay(); const est = llmEst();
      if (llmInflight >= cfg.LLM_MAX_INFLIGHT) { llmRefusal = "busy"; return null; }
      if (d.usd + d.reserved + est > cfg.LLM_DAILY_BUDGET_USD) { llmRefusal = "cap"; return null; }
      llmRefusal = null; llmInflight++; d.reserved += est; return est; },
    settle: (est: number, actual: number) => { llmInflight = Math.max(0, llmInflight - 1); const d = llmDay(); d.reserved = Math.max(0, d.reserved - est); d.usd += actual; d.maxCall = Math.max(d.maxCall, actual); },
    refusal: () => llmRefusal, maxOutputTokens: cfg.LLM_MAX_OUTPUT_TOKENS, checkpoint: o.durable ? () => o.durable!.commit() : undefined };
  const today = () => new Date(clock.now()).toISOString().slice(0, 10);
  // M3.5: bounded, expiring rate-limit map (entries expire at their window end; size capped; M3.6: new keys refused with 429 when full).
  // M5.24a: per-request ledger of rate-limit + compile-quota charges (AsyncLocalStorage), refunded on validation rejects.
  type Ledger = { rl: { key: string; w: number }[]; compile: { u: User; day: string }[]; refund: boolean };
  const charged = new AsyncLocalStorage<Ledger>();
  const RL_MAX = o.rlMax ?? 50_000; const rl = new Map<string, { win: number; n: number; until: number }>();
  const rlPrune = () => { const now = clock.now(); for (const [k, e] of rl) if (e.until <= now) rl.delete(k); };
  const limit = (key: string, max: number, winMs: number) => {
    const w = Math.floor(clock.now() / winMs); const e = rl.get(key);
    // M3.6: when the map is full (after pruning expired entries) refuse NEW keys with 429; never evict live counters.
    if (!e || e.win !== w) { if (!e && rl.size >= RL_MAX) { rlPrune(); if (rl.size >= RL_MAX) throw new ApiErr("rate_limited", "Too many requests.", undefined, Math.ceil(winMs / 1000)); } rl.delete(key); rl.set(key, { win: w, n: 1, until: (w + 1) * winMs }); charged.getStore()?.rl.push({ key, w }); return; }
    if (++e.n > max) throw new ApiErr("rate_limited", "Too many requests.", undefined, Math.ceil(((w + 1) * winMs - clock.now()) / 1000));
    charged.getStore()?.rl.push({ key, w });
  };
  /** M5.24a: undo this request's rate-limit/quota charges (called when it is rejected as invalid input). */
  const refundCharges = (led: Ledger) => {
    for (const { key, w } of led.rl) { const e = rl.get(key); if (e && e.win === w && e.n > 0) e.n--; }
    for (const { u, day } of led.compile) if (u.compiles.day === day && u.compiles.n > 0) u.compiles.n--;
    led.rl.length = 0; led.compile.length = 0;
  };
  const rlTimer = o.autoTimers === false ? null : setInterval(rlPrune, 60_000); rlTimer?.unref?.();
  // M3.5: single-use stream tickets (jti -> exp ms) and per-user SSE connection counts.
  const usedTickets = new Map<string, number>(); const sseOpen = new Map<string, number>();

  // ---------- helpers ----------
  const stockOk = (u: User) => u.eligibility.stockTokens === "allowed";
  /** M3.1 geo policy: eligibility gates LIVE Stock Token execution only. Demo, paper, backtest, quotes and compile are never geo-blocked. */
  const geoGate = (mode: string, u: User) => mode === "live" ? stockOk(u) : true;
  const usesStock = (st: any) => Array.isArray(st?.actions) && st.actions.some((x: any) => { const m = registry.get(x?.instrument); return m?.venue === "robinhood" && (m.assetClass === "equity" || m.assetClass === "etf"); });
  const geoNote = (u: User, st: unknown): ValidationIssue[] => !stockOk(u) && usesStock(st) ? [{ path: "/actions", code: "geo_restricted", severity: "warning", message: "Stock Tokens run in demo/paper only for your region; live execution is not available." }] : [];
  const ipCountry = (c: Context): string | null => {
    // Mock: x-mock-country header (default DE). Testnet/mainnet: GEO_IP_DB_PATH lookup (MaxMind) — not wired yet => null (unknown, fail closed for Stock Tokens).
    if (cfg.QUIVR_MODE !== "mock") return c.req.header("cf-ipcountry")?.toUpperCase() ?? null;
    return (c.req.header("x-mock-country") ?? "DE").toUpperCase();
  };
  const computeElig = (u: User, country: string | null) => {
    u.eligibility.country = country;
    if (country && blocked.has(country)) { u.eligibility.stockTokens = "blocked"; u.eligibility.reason = "Stock Tokens aren't available in your region."; }
    else if (!country) { u.eligibility.stockTokens = "unknown"; u.eligibility.reason = "Couldn't determine your region."; }
    else if (!u.eligibility.selfDeclaredNonUsPerson) { u.eligibility.stockTokens = "unknown"; u.eligibility.reason = "Declaration required"; }
    else { u.eligibility.stockTokens = "allowed"; u.eligibility.reason = null; }
  };
  const meView = (u: User) => ({ id: u.id, createdAt: iso(u.createdAt), displayName: u.displayName, wallets: [{ chain: "robinhood" as const, address: u.wallet, kind: "embedded" as const }],
    eligibility: u.eligibility, enabledModes: ["paper" as const], quotas: { compilesPerDay: cfg.LLM_USER_DAILY_COMPILES, compilesUsedToday: u.compiles.day === today() ? u.compiles.n : 0 } });
  // M5.28: a decimal string with more than 18 fraction digits fails the AmountStr regex; surface details.reason "too_many_decimals"
  // (details becomes { reason, issues }) so clients see the same reason as the per-asset check. Other failures keep the issue array.
  const valDetails = (issues: z.core.$ZodIssue[], raw: unknown) => { const fi = friendlyIssues(issues);
    const at = (pth: PropertyKey[]) => pth.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<PropertyKey, unknown>)[k] : undefined), raw);
    return issues.some((i) => { const v = at(i.path); return typeof v === "string" && /^[0-9]+\.[0-9]{19,}$/.test(v); }) ? { reason: "too_many_decimals", issues: fi } : fi; };
  const body = async <T extends z.ZodTypeAny>(c: Context, s: T): Promise<z.infer<T>> => {
    let raw: unknown; try { raw = await c.req.json(); } catch { throw new ApiErr("validation_failed", "Body must be JSON."); }
    const r = s.safeParse(raw); if (!r.success) throw new ApiErr("validation_failed", "Invalid request.", valDetails(r.error.issues, raw)); return r.data;
  };
  const query = <T extends z.ZodTypeAny>(c: Context, s: T): z.infer<T> => { const qv = c.req.query(); const r = s.safeParse(qv); if (!r.success) throw new ApiErr("validation_failed", "Invalid query.", valDetails(r.error.issues, qv)); return r.data; };
  const idemInflight = new Map<string, Promise<[unknown, number]>>();
  const idem = async (c: Context<Env>, fn: () => Promise<[unknown, number]>) => {
    const k = c.req.header("idempotency-key"); const key = k && `${c.get("user").id}:${c.req.method}:${c.req.path}:${k}`;
    if (key) { const hit = store.idem.get(key); if (hit && clock.now() - hit.at < 86_400_000) return c.json(hit.body as object, hit.status as 200); }
    let task = key ? idemInflight.get(key) : undefined;
    if (!task) {
      task = fn().then(([b, s]) => { if (key) store.idem.set(key, { at: clock.now(), status: s, body: b }); return [b, s] as [unknown, number]; });
      if (key) idemInflight.set(key, task);
    }
    try { const [b, s] = await task; return c.json(b as object, s as 200); }
    finally { if (key && idemInflight.get(key) === task) idemInflight.delete(key); }
  };
  const strategyRecord = (s: StrategyRow, v?: number) => {
    const ver = v !== undefined ? s.versions.find((x) => x.version === v) : s.versions.at(-1); if (!ver) throw new ApiErr("not_found", "Version not found.");
    const active = [...runs.live.values()].find((l) => l.run.strategyId === s.id && l.run.status !== "stopped");
    return { id: s.id, ownerId: s.ownerId, name: ver.strategy.name, version: ver.version, status: s.archived ? "archived" as const : hasErrors(ver.issues) ? "invalid" as const : "valid" as const,
      strategy: ver.strategy, humanized: ver.humanized, issues: ver.issues, venues: [...new Set(ver.strategy.actions.map((a) => registry.get(a.instrument)?.venue).concat(ver.strategy.signals.map((g) => ("instrument" in g.params ? registry.get(g.params.instrument)?.venue : undefined))).filter(Boolean))] as any,
      createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt), activeRunId: active?.run.id ?? null,
      nodes: strategyNodes(ver.strategy, registry, ver.humanized), public: !!s.public, forkedFrom: s.forkedFrom ?? null };
  };
  const ownStrategy = (c: Context<Env>, id: string) => { const s = store.strategies.get(id); if (!s || s.ownerId !== c.get("user").id) throw new ApiErr("not_found", "Strategy not found."); return s; };
  const ownRun = (c: Context<Env>, id: string) => { const r = store.runs.get(id); if (!r || r.ownerId !== c.get("user").id) throw new ApiErr("not_found", "Run not found."); return r; };

  const app = new Hono<Env>().basePath("/v1");
  const ORIGINS = cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  // M3.5: security headers on every response (API: nothing to frame or sniff).
  app.use("*", secureHeaders({ xContentTypeOptions: "nosniff", xFrameOptions: "DENY", referrerPolicy: "no-referrer",
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }, crossOriginResourcePolicy: "same-site" }));
  // M3.6: Access-Control-Allow-Credentials only when the Origin is on the allowlist.
  const corsOpts = { origin: (o: string) => (ORIGINS.includes(o) ? o : null), allowHeaders: ["authorization", "content-type", "idempotency-key", "last-event-id", "x-mock-country"], exposeHeaders: ["x-quiver-rpc"] /* M5.16 */ };
  const corsCred = cors({ ...corsOpts, credentials: true }), corsAnon = cors({ ...corsOpts, credentials: false });
  app.use("*", (c, next) => (ORIGINS.includes(c.req.header("origin") ?? "") ? corsCred : corsAnon)(c, next));
  // M5.24a: invalid input (422 validation_failed / 413) gives back every limit + quota slot the request took.
  // Invalid requests are still capped on their own (120/min per IP) so junk floods stay bounded.
  const REFUNDABLE = new Set<string>(["validation_failed", "payload_too_large"]);
  app.use("*", (c, next) => { const led: Ledger = { rl: [], compile: [], refund: false };
    return charged.run(led, async () => { await next();
      if (led.refund) { refundCharges(led); try { const uid = (c.get("user") as { id?: string } | undefined)?.id; // M5.25: optional per-user cap too
        if (uid && cfg.INVALID_PER_USER_PER_MIN > 0) limit(`invu:${uid}`, cfg.INVALID_PER_USER_PER_MIN, 60_000);
        limit(`inv:${clientIp(c)}`, 120, 60_000); led.rl.length = 0; } catch (e) { led.rl.length = 0; if (e instanceof ApiErr) { c.res = c.json({ error: { code: e.code, message: e.message, requestId: c.get("requestId") ?? "", retryAfterSec: e.retryAfterSec } }, 429); c.header("Retry-After", String(e.retryAfterSec ?? 60)); } } } }); });
  app.use("*", async (c, next) => { c.set("requestId", "req_" + randomToken(8)); await next(); c.header("x-request-id", c.get("requestId")); if (persist && c.req.method !== "GET") persist.touch(); });
  app.use("*", async (c, next) => {
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    const unavailable = () => c.json({ error: { code: "service_unavailable", message: "The service cannot save changes right now. Please retry shortly.", requestId: c.get("requestId"), retryAfterSec: 5 } }, 503);
    if (o.isDraining?.() || (mutation && o.durable && !o.durable.healthy)) { c.header("Retry-After", "5"); return unavailable(); }
    await next();
    if (mutation && o.durable) {
      try { await o.durable.commit(); }
      catch { c.header("Retry-After", "5"); c.res = unavailable(); }
    }
  });
  // M3.4: request size caps (compile allows 2 images ≈ 5.6 MB base64; everything else 64 KB). Enforced on the stream, not just Content-Length.
  const tooLarge = (c: Context<any>) => c.json({ error: { code: "payload_too_large", message: "Request body is too large.", requestId: c.get("requestId") } }, 413);
  const bigLimit = bodyLimit({ maxSize: 6_000_000, onError: tooLarge }), smallLimit = bodyLimit({ maxSize: 65_536, onError: tooLarge });
  app.use("*", (c, next) => (c.req.path === "/v1/compile" || c.req.path === "/v1/compile/image" ? bigLimit : smallLimit)(c, next));
  app.onError((e, c) => {
    if (e instanceof ApiErr) {
      const status = HTTP_STATUS[e.code];
      if (REFUNDABLE.has(e.code)) { const led = charged.getStore(); if (led) led.refund = true; }
      // M3.6.1: every 429 carries Retry-After (whole seconds, ≥ 1) matching error.retryAfterSec.
      const retryAfterSec = status === 429 ? Math.max(1, Math.ceil(e.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC)) : e.retryAfterSec;
      if (status === 429) c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}), requestId: c.get("requestId"), ...(retryAfterSec ? { retryAfterSec } : {}) } }, status as 400);
    }
    console.error(JSON.stringify({ level: "error", requestId: c.get("requestId"), msg: redact(String((e as Error).message)) }));
    return c.json({ error: { code: "internal", message: "Something went wrong.", requestId: c.get("requestId") } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found.", requestId: c.get("requestId") } }, 404));

  /** Client IP for rate limits: X-Forwarded-For only behind a trusted proxy (TRUST_PROXY=true), else the socket address. */
  const peerAddr = (c: Context<any>) => (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  const isLoopback = (a: string | undefined) => !!a && (/^127\./.test(a) || a === "::1" || /^::ffff:127\./i.test(a));
  // M5.21 (B2): XFF only with TRUST_PROXY, and (default TRUST_PROXY_PEERS=loopback) only when the TCP peer is loopback, i.e. Caddy on
  // this host, which overwrites XFF. An in-process request with no socket (tests) counts as the proxy.
  const clientIp = (c: Context<any>) => { const peer = peerAddr(c);
    const trust = cfg.TRUST_PROXY && (cfg.TRUST_PROXY_PEERS === "any" || peer === undefined || isLoopback(peer));
    return (trust ? c.req.header("x-forwarded-for")?.split(",")[0].trim() || undefined : undefined) ?? peer ?? "local"; };
  // M5.21 (W1/B1): the web server's own server-side calls get a separate, larger bucket. Needs INTERNAL_PROXY_TOKEN set, the
  // X-Quiver-Internal-Token header equal to it (constant-time on SHA-256 digests) and a loopback TCP peer. Otherwise per-IP as before.
  const internalDigest = cfg.INTERNAL_PROXY_TOKEN ? createHash("sha256").update(cfg.INTERNAL_PROXY_TOKEN).digest() : null;
  const isInternal = (c: Context<any>) => { if (!internalDigest) return false; const h = c.req.header("x-quiver-internal-token"); if (!h || h.length > 256) return false;
    return timingSafeEqual(createHash("sha256").update(h).digest(), internalDigest) && isLoopback(peerAddr(c)); };
  const INTERNAL_MULT = 20;
  const pubLimit = (c: Context<any>, name: string, max: number, winMs = 60_000) => isInternal(c) ? limit(`${name}:internal`, max * INTERNAL_MULT, winMs) : limit(`${name}:${clientIp(c)}`, max, winMs);
  const isSseReq = (c: Context<any>) => c.req.query("ticket") !== undefined || (c.req.header("accept") ?? "").includes("text/event-stream");
  /** M3.5: does any registered (non-middleware) route match this path? Built lazily once all routes exist. */
  let routeRes: RegExp[] | null = null;
  const knownPath = (path: string) => {
    routeRes ??= app.routes.filter((x) => x.method !== "ALL" && !x.path.includes("*")).map((x) => new RegExp("^" + x.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]+/g, "[^/]+") + "/?$"));
    return routeRes.some((re) => re.test(path));
  };
  const auth = async (c: Context<Env>, next: () => Promise<void>) => {
    if (c.req.method === "GET" && (/^\/v1\/runs\/[^/]+\/events\/stream$/.test(c.req.path) || (/^\/v1\/runs\/[^/]+\/events$/.test(c.req.path) && isSseReq(c)))) return next(); // ticket-auth SSE routes
    if (!knownPath(c.req.path)) return void (c.res = c.json({ error: { code: "not_found", message: "Route not found.", requestId: c.get("requestId") } }, 404)); // M3.5: 404 before 401
    const h = c.req.header("authorization"); const tok = h?.startsWith("Bearer ") ? h.slice(7) : null;
    const p = tok ? verifyJwt<{ sub: string }>(tok, secret, clock.now()) : null;
    const u = p && store.users.get(p.sub); if (!u) throw new ApiErr("unauthorized", "Sign in again.");
    c.set("user", u); limit(`u:${u.id}`, 600, 60_000); // 60/min spec; 600 burst in mock for SSE-heavy UIs
    await next();
  };
  /** M3.5: refresh cookie is Secure everywhere except plain-http localhost dev in mock mode. */
  const isLocalHost = (c: Context) => { const h = (c.req.header("host") ?? new URL(c.req.url).host).replace(/:\d+$/, "").toLowerCase(); return h === "localhost" || h === "127.0.0.1" || h === "[::1]"; };
  const issue = (c: Context, u: User) => {
    const { token, exp } = signJwt({ sub: u.id }, secret, 900, clock.now());
    const rt = randomToken(); store.refresh.set(rt, { userId: u.id, exp: clock.now() + 30 * 86_400_000 });
    setCookie(c, "quiver_rt", rt, { httpOnly: true, sameSite: "Strict", path: "/v1/auth", secure: !(cfg.QUIVR_MODE === "mock" && isLocalHost(c)), maxAge: 30 * 86400 });
    return { accessToken: token, expiresAt: iso(exp) };
  };

  // ---------- public ----------
  // M5.21 (B6): liveness + warmup state. Always 200 once listening; `ready` is false while history is loading.
  app.get("/health", (c) => c.json({ ok: true, ready: !warmup.warming, warmup: warmup.view(), notice: warmup.warming ? WARMUP_OBJ : null } satisfies z.infer<typeof O.HealthRes>));
  app.get("/ready", (c) => {
    const ready = !o.isDraining?.() && (!o.durable || o.durable.healthy);
    return c.json({ ready, storage: o.durable ? (o.durable.healthy ? "postgres" : "unavailable") : "memory", execution: "paper", prices: cfg.PRICE_SOURCE === "mock" ? "synthetic" : "read-only", ai: !!cfg.OPENROUTER_API_KEY, auth: !!cfg.PRIVY_APP_ID, warmup: warmup.view().state }, ready ? 200 : 503);
  });
  app.get("/status", (c) => c.json({ ok: !killSwitch, warmingUp: warmup.warming, mode: cfg.QUIVR_MODE, chainId: cfg.CHAIN_ID, venues: venueInfo(), engineLagSec: 0 }));
  const venueInfo = () => Object.values(adapters).map((a) => ({ id: a.id, name: a.name, status: a.status(), capabilities: a.capabilities, note: a.note }));

  const privy = o.privy ?? new PrivyVerifier({ jwksMinIntervalMs: cfg.PRIVY_JWKS_MIN_INTERVAL_MS, appId: cfg.PRIVY_APP_ID, appSecret: cfg.PRIVY_APP_SECRET, verificationKeyPem: cfg.PRIVY_VERIFICATION_KEY, jwksUrl: cfg.PRIVY_JWKS_URL, now: () => clock.now() });
  app.get("/auth/config", (c) => c.json({ privy: { enabled: privy.configured, appId: privy.configured ? privy.appId : null }, devLogin: cfg.DEV_LOGIN_ENABLED, walletLink: { enabled: walletLinkOn, method: "personal_sign", maxWallets: MAX_WALLETS } } satisfies AU.AuthConfigRes));
  app.post("/auth/exchange", async (c) => {
    limit(`auth:${clientIp(c)}`, 20, 60_000);
    const b = await body(c, A.AuthExchangeReq);
    if (!(cfg.DEV_LOGIN_ENABLED && b.idToken.startsWith("dev:"))) {
      // M5.2: real Privy verification; fails closed when PRIVY_APP_ID/SECRET are unset.
      if (b.idToken.startsWith("dev:")) throw new ApiErr("unauthorized", "Dev login is off in this environment.");
      if (!privy.configured) throw new ApiErr("auth_unavailable", "Sign-in is not configured on this server yet.");
      let id; try { id = await privy.verify(b.idToken); }
      catch (e) { if (e instanceof PrivyUnavailable) throw new ApiErr("auth_unavailable", "Sign-in is temporarily unavailable. Try again."); throw new ApiErr("unauthorized", "Sign-in failed. Try again."); }
      const label = `privy:${id.sub}`; let u = store.users.get(store.usersByLabel.get(label) ?? "");
      if (!u) {
        const wallet = id.wallets[0] ? getAddress(id.wallets[0]) : getAddress("0x" + keccak256(toHex(`quiver-privy:${id.sub}`)).slice(26));
        u = { id: newId("usr", clock.now()), createdAt: clock.now(), displayName: null, label, wallet, termsVersion: null, compiles: { day: "", n: 0 }, eligibility: { country: null, selfDeclaredNonUsPerson: false, stockTokens: "unknown", reason: "Declaration required" },
          linkedWallets: id.wallets[0] ? [{ address: getAddress(id.wallets[0]), linkedAt: clock.now() }] : [] };
        store.users.set(u.id, u); store.usersByLabel.set(label, u.id);
      }
      computeElig(u, ipCountry(c)); store.audit.push({ at: clock.now(), userId: u.id, action: "auth.privy" });
      return c.json({ ...issue(c, u), me: meView(u) });
    }
    const [, label, addr] = b.idToken.split(":");
    let u = store.users.get(store.usersByLabel.get(label) ?? "");
    if (!u) {
      const wallet = addr && /^0x[0-9a-fA-F]{40}$/.test(addr) ? getAddress(addr) : getAddress("0x" + keccak256(toHex(`quiver-dev:${label}`)).slice(26));
      u = { id: newId("usr", clock.now()), createdAt: clock.now(), displayName: null, label, wallet, termsVersion: null, compiles: { day: "", n: 0 }, eligibility: { country: null, selfDeclaredNonUsPerson: false, stockTokens: "unknown", reason: "Declaration required" } };
      store.users.set(u.id, u); store.usersByLabel.set(label, u.id);
    }
    computeElig(u, ipCountry(c));
    return c.json({ ...issue(c, u), me: meView(u) });
  });
  app.post("/auth/refresh", (c) => {
    limit(`ref:${clientIp(c)}`, 30, 60_000);
    const rt = getCookie(c, "quiver_rt"); const e = rt && store.refresh.get(rt);
    if (!e || e.exp < clock.now()) throw new ApiErr("unauthorized", "Session expired.");
    store.refresh.delete(rt!); const u = store.users.get(e.userId)!; return c.json(issue(c, u)); // rotation
  });
  app.post("/auth/logout", (c) => { const rt = getCookie(c, "quiver_rt"); if (rt) store.refresh.delete(rt); deleteCookie(c, "quiver_rt", { path: "/v1/auth" }); return c.body(null, 204); });

  const NOTICE = exampleNotices(cfg.PRICE_SOURCE);
  /** Per-user daily compile quota, shared by /compile and M4.9.1 /runs/:id/instruct (B2). */
  const chargeCompile = (u: User) => { if (u.compiles.day !== today()) u.compiles = { day: today(), n: 0 }; if (u.compiles.n >= cfg.LLM_USER_DAILY_COMPILES) throw new ApiErr("compile_quota_exceeded", "Daily compile limit reached.", undefined, Math.ceil((Date.parse(today() + "T00:00:00Z") + 86_400_000 - clock.now()) / 1000)); u.compiles.n++; charged.getStore()?.compile.push({ u, day: today() }); };
  // ---------- M5.9 user secrets vault ----------
  const vault = new SecretVault(cfg.SECRETS_MASTER_KEY);
  const aadOf = (x: { ownerId: string; kind: string; id: string }) => `${x.ownerId}:${x.kind}:${x.id}`;
  /** Plaintext AI key for this user's own compiles, or undefined. Never leaves the process except to OpenRouter. */
  const userAiKey = (u: User | undefined) => { if (!u) return undefined; const x = [...store.userSecrets.values()].find((s) => s.ownerId === u.id && s.kind === "ai_key");
    const k = x ? vault.open(x.sealed, aadOf(x)) ?? undefined : undefined; if (x && k) x.lastUsedAt = clock.now(); return k; };
  // ---------- compile (guest allowed) ----------
  app.post("/compile", async (c) => {
    const b = await body(c, A.CompileReq);
    const h = c.req.header("authorization"); const p = h?.startsWith("Bearer ") ? verifyJwt<{ sub: string }>(h.slice(7), secret, clock.now()) : null;
    const u = p ? store.users.get(p.sub) : undefined;
    const ip = clientIp(c);
    if (u) { limit(`c:${u.id}`, 6, 60_000); chargeCompile(u); }
    else limit(`g:${ip}:${today()}`, 3, 86_400_000);
    const key = userAiKey(u) ?? cfg.OPENROUTER_API_KEY;
    const gen = compile(b, { registry, stockTokensAllowed: true, delayMs: o.compileDelayMs ?? 0,
      openrouter: key ? { apiKey: key, model: cfg.LLM_MODEL ?? "openai/gpt-4.1-mini", budget: llmBudget } : undefined });
    c.header("content-type", "application/x-ndjson"); c.header("cache-control", "no-store");
    return stream(c, async (s) => { for await (const ev of gen) await s.write(JSON.stringify(ev) + "\n"); });
  });

  // ---------- authed ----------
  const r = new Hono<Env>();
  r.use("*", auth);
  r.get("/me", (c) => c.json(meView(c.get("user"))));
  r.post("/me/eligibility", async (c) => {
    const b = await body(c, A.EligibilityDeclareReq); const u = c.get("user");
    if (b.acceptedTermsVersion !== cfg.TERMS_VERSION) throw new ApiErr("validation_failed", `Accept the current terms (${cfg.TERMS_VERSION}).`);
    const country = ipCountry(c);
    u.eligibility.selfDeclaredNonUsPerson = true; u.termsVersion = b.acceptedTermsVersion;
    computeElig(u, country);
    if (country && b.countryOfResidence.toUpperCase() !== country) { u.eligibility.stockTokens = "unknown"; u.eligibility.reason = "Declared country doesn't match your network location."; }
    if (blocked.has(b.countryOfResidence.toUpperCase())) { u.eligibility.stockTokens = "blocked"; u.eligibility.reason = "Stock Tokens aren't available in your region."; }
    store.audit.push({ at: clock.now(), userId: u.id, action: "eligibility.declare" });
    return c.json(meView(u));
  });
  r.post("/stream-tickets", async (c) => {
    const b = await body(c, z.object({ runId: RunId })); ownRun(c, b.runId);
    const { token, exp } = signJwt({ sub: c.get("user").id, run: b.runId, typ: "stream", jti: randomToken(12) }, secret, 60, clock.now()); // M3.5: single-use
    return c.json({ ticket: token, expiresAt: iso(exp) });
  });

  // M5.6 compile from a chart screenshot (vision). Signed-in only; same per-user quota, rate limit and LLM daily budget as /compile.
  r.post("/compile/image", async (c) => {
    const u = c.get("user"); limit(`ci:${u.id}`, 3, 60_000);
    const b = await body(c, A.CompileImageReq);
    const key = userAiKey(u) ?? cfg.OPENROUTER_API_KEY;
    if (!key) throw new ApiErr("vision_unavailable", "Chart screenshots need the AI compiler, which isn't configured here. Describe the idea in text instead.");
    const chk = checkImage(b.imageBase64, b.mimeType); if (!chk.ok) throw new ApiErr(chk.reason === "too_large" ? "payload_too_large" : "image_invalid", chk.message, { reason: chk.reason, maxBytes: IMAGE_MAX_BYTES, minPx: IMAGE_MIN_PX, maxPx: IMAGE_MAX_PX });
    if (llmBudget.spentToday() >= llmBudget.capUsd) throw new ApiErr("compile_cost_cap", "Daily AI budget reached. Try again tomorrow.", undefined, Math.ceil((Date.parse(today() + "T00:00:00Z") + 86_400_000 - clock.now()) / 1000));
    chargeCompile(u);
    store.audit.push({ at: clock.now(), userId: u.id, action: "compile.image", target: `${chk.mime}:${chk.width}x${chk.height}:${chk.bytes}:${chk.sha256.slice(0, 16)}` });
    const note = b.note?.replace(/\p{Cc}/gu, " ").trim() || undefined;
    const gen = compile({ thesis: note ?? "Strategy from a chart screenshot", note, image: { mime: chk.mime, base64: b.imageBase64.replace(/^data:[^;,]+;base64,/, "") } }, { registry, stockTokensAllowed: true, delayMs: o.compileDelayMs ?? 0,
      openrouter: { apiKey: key, model: cfg.LLM_VISION_MODEL ?? cfg.LLM_MODEL ?? "openai/gpt-4.1-mini", budget: llmBudget } });
    c.header("content-type", "application/x-ndjson"); c.header("cache-control", "no-store");
    return stream(c, async (s) => { let failed = false; for await (const ev of gen) { if (ev.type === "error") failed = true; await s.write(JSON.stringify(ev) + "\n"); }
      if (failed && u.compiles.day === today() && u.compiles.n > 0) u.compiles.n--; }); // failed reads don't count against the quota
  });
  r.post("/strategies/validate", async (c) => {
    const b = await body(c, A.ValidateReq); const v0 = validateStrategy(b.strategy, { registry, stockTokensAllowed: true }); const v = { ...v0, issues: [...v0.issues, ...geoNote(c.get("user"), v0.strategy)] };
    return c.json({ ok: !!v.strategy && !hasErrors(v.issues), strategy: v.strategy, humanized: v.strategy ? humanize(v.strategy, registry) : null, issues: v.issues });
  });
  const saveVersion = (c: Context<Env>, raw: unknown) => {
    const v0 = validateStrategy(raw, { registry, stockTokensAllowed: true }); const v = { ...v0, issues: [...v0.issues, ...geoNote(c.get("user"), v0.strategy)] };
    if (!v.strategy) throw new ApiErr("strategy_invalid", "Strategy is invalid.", v.issues);
    return { strategy: v.strategy, humanized: humanize(v.strategy, registry), issues: v.issues, createdAt: clock.now() };
  };
  r.get("/strategies", (c) => {
    const q = query(c, A.ListStrategiesQuery); const uid = c.get("user").id;
    const rows = [...store.strategies.values()].filter((s) => s.ownerId === uid).map((s) => strategyRecord(s)).filter((s) => (q.status ? s.status === q.status : s.status !== "archived"));
    const p = paginate(rows as any[], (x) => Date.parse(x.updatedAt), q.limit, q.cursor);
    return c.json({ items: p.items.map((s: any) => ({ id: s.id, name: s.name, version: s.version, status: s.status, venues: s.venues, updatedAt: s.updatedAt, activeRunId: s.activeRunId })), nextCursor: p.nextCursor });
  });
  r.post("/strategies", (c) => idem(c, async () => {
    const b = await body(c, A.CreateStrategyReq); const v = saveVersion(c, b.strategy);
    const row: StrategyRow = { id: newId("stg", clock.now()), ownerId: c.get("user").id, archived: false, versions: [{ version: 1, ...v }], createdAt: clock.now(), updatedAt: clock.now(), compileId: b.compileId };
    store.strategies.set(row.id, row); return [strategyRecord(row), 201];
  }));
  r.get("/strategies/:id", (c) => c.json(strategyRecord(ownStrategy(c, c.req.param("id")))));
  r.get("/strategies/:id/versions/:v", (c) => {
    const v = c.req.param("v"); if (!/^[1-9]\d{0,8}$/.test(v)) throw new ApiErr("not_found", "Version not found."); // M3.5: no fallback to latest
    return c.json(strategyRecord(ownStrategy(c, c.req.param("id")), Number(v)));
  });
  r.put("/strategies/:id", async (c) => {
    const s = ownStrategy(c, c.req.param("id")); const b = await body(c, A.UpdateStrategyReq);
    if (b.expectedVersion !== s.versions.at(-1)!.version) throw new ApiErr("conflict", `Strategy changed (now v${s.versions.at(-1)!.version}). Reload and retry.`);
    s.versions.push({ version: b.expectedVersion + 1, ...saveVersion(c, b.strategy) }); s.updatedAt = clock.now(); return c.json(strategyRecord(s));
  });
  r.delete("/strategies/:id", (c) => {
    const s = ownStrategy(c, c.req.param("id")); if (strategyRecord(s).activeRunId) throw new ApiErr("run_already_active", "Stop the running strategy first.");
    s.archived = true; s.updatedAt = clock.now(); return c.body(null, 204);
  });

  // ---------- backtests ----------
  r.post("/backtests", (c) => idem(c, async () => {
    const b = await body(c, A.BacktestReq); const u = c.get("user");
    if (!!b.strategyId === !!b.strategy) throw new ApiErr("validation_failed", "Provide exactly one of strategyId or strategy.");
    const raw = b.strategyId ? ownStrategy(c, b.strategyId).versions.at(-1)!.strategy : b.strategy;
    const v = validateStrategy(raw, { registry, stockTokensAllowed: true }); // backtests are research: geo applies to trading, not simulation
    if (!v.strategy || hasErrors(v.issues)) throw new ApiErr("strategy_invalid", "Strategy is invalid.", v.issues);
    const from = Date.parse(b.from), toReq = Date.parse(b.to);
    // M3.5: no future ranges, and no ranges starting before the history window (v1 keeps the last 365 days).
    // M3.6: client clock skew: `to` up to BACKTEST_MAX_FUTURE_SKEW_MS ahead of server now is clamped to now; further ahead is 422.
    const now = clock.now(), earliest = earliestFrom(now);
    if (toReq > now + BACKTEST_MAX_FUTURE_SKEW_MS) throw new ApiErr("backtest_range_invalid", "`to` is in the future. Backtests only cover past data.", { reason: "future", latestTo: iso(now) });
    const to = Math.min(toReq, now);
    try { checkRange({ from, to, resolution: b.resolution }); } catch (e) { if (e instanceof BacktestError) throw new ApiErr(e.code, e.message); throw e; }
    if (from < earliest) throw new ApiErr("backtest_range_invalid", "`from` is before the start of available history (the last 365 days).", { reason: "before_data", earliestFrom: iso(earliest) });
    if ([...store.backtests.values()].filter((x) => x.ownerId === u.id && (x.res.status === "queued" || x.res.status === "running")).length >= 3) throw new ApiErr("rate_limited", "Up to 3 backtests at once.", undefined, 5);
    const row = { id: newId("bkt", clock.now()), ownerId: u.id, canceled: false, listeners: new Set<any>(), res: { id: "", status: "queued" as const, progress: 0, dataSource: "fallback" as const, dataCoverage: [], result: null, error: null, warmup: warmup.warming, warmupNotice: warmup.warming ? WARMUP_OBJ : null } as z.infer<typeof A.BacktestRes> };
    row.res.id = row.id; store.backtests.set(row.id, row);
    const notify = (type: "progress" | "done", data: unknown) => row.listeners.forEach((f) => f({ type, data }));
    setImmediate(async () => {
      row.res.status = "running";
      try {
        const bm = await backtestMarket(v.strategy!, from, to, RES_MS[b.resolution], row.ownerId); row.res.dataSource = bm.dataSource;
        const out = await runBacktest({ strategy: v.strategy!, from, to, resolution: b.resolution, startingEquity: Number(b.startingEquityUsd), feeModel: b.feeModel }, { mkt: bm.m, adapters, registry, stockTokensAllowed: true },
          { progress: (p) => { row.res.progress = Number(p.toFixed(3)); notify("progress", { progress: row.res.progress }); }, canceled: () => row.canceled });
        if (!out) row.res.status = "canceled"; else { row.res.status = "done"; const wu = warmup.warming && bm.dataSource !== "tiingo"; row.res.warmup = wu; row.res.warmupNotice = wu ? WARMUP_OBJ : null; if (wu) out.result.caveats = [WARMUP_NOTICE, ...(out.result.caveats ?? [])]; row.res.result = out.result; row.res.dataCoverage = out.coverage; row.res.progress = 1; }
      } catch (e) { // M3.5: never echo raw internal error text to the client
        row.res.status = "failed"; row.res.error = e instanceof BacktestError ? e.message : "Backtest failed. Try again or change the range.";
        if (!(e instanceof BacktestError)) console.error(JSON.stringify({ level: "error", backtestId: row.id, msg: redact(String((e as Error).message)) }));
      }
      notify("done", row.res);
    });
    return [row.res, 202];
  }));
  const ownBt = (c: Context<Env>) => { const b = store.backtests.get(c.req.param("id")!); if (!b || b.ownerId !== c.get("user").id) throw new ApiErr("not_found", "Backtest not found."); return b; };
  r.get("/backtests/:id", (c) => c.json(ownBt(c).res));
  r.post("/backtests/:id/cancel", (c) => { const b = ownBt(c); if (b.res.status === "queued" || b.res.status === "running") { b.canceled = true; b.res.status = "canceled"; } return c.json(b.res); });
  r.get("/backtests/:id/events", (c) => { const b = ownBt(c); return streamSSE(c, async (s) => {
    if (b.res.status === "done" || b.res.status === "failed" || b.res.status === "canceled") { await s.writeSSE({ event: "done", data: JSON.stringify(b.res) }); return; }
    await new Promise<void>((resolve) => { const f = (e: { type: string; data: unknown }) => { s.writeSSE({ event: e.type, data: JSON.stringify(e.data) }); if (e.type === "done") { b.listeners.delete(f); resolve(); } }; b.listeners.add(f); s.onAbort(() => { b.listeners.delete(f); resolve(); }); });
  }); });

  // ---------- runs ----------
  /** Shared by POST /runs and M4.5 autopilot: every guard (paper-only, validation, per-user cap, one run per strategy) applies to both. */
  const startRunFor = (u: User, b: z.infer<typeof A.StartRunReq>) => {
    if (b.mode !== "paper") throw new ApiErr("mode_not_enabled", `${b.mode} runs aren't enabled for your account yet.`);
    const s = store.strategies.get(b.strategyId); if (!s || s.ownerId !== u.id) throw new ApiErr("not_found", "Strategy not found."); if (s.archived) throw new ApiErr("not_found", "Strategy is archived.");
    const ver = b.version ? s.versions.find((x) => x.version === b.version) : s.versions.at(-1); if (!ver) throw new ApiErr("not_found", "Version not found.");
    const v = validateStrategy(ver.strategy, { registry, stockTokensAllowed: geoGate(b.mode ?? "paper", u) });
    if (hasErrors(v.issues)) throw new ApiErr(v.issues.some((i) => i.code === "geo_restricted") ? "geo_restricted" : "strategy_invalid", "Strategy can't run as-is.", v.issues);
    if ([...runs.live.values()].some((l) => l.run.strategyId === s.id && l.run.mode === b.mode)) throw new ApiErr("run_already_active", "This strategy is already running in this mode.");
    const active = [...runs.live.values()].filter((l) => l.run.ownerId === u.id && l.run.status !== "stopped").length; // M3.5 per-user cap
    if (active >= cfg.MAX_ACTIVE_RUNS_PER_USER) throw new ApiErr("limit_exceeded", `Up to ${cfg.MAX_ACTIVE_RUNS_PER_USER} active runs per account. Stop one to start another.`, { limit: cfg.MAX_ACTIVE_RUNS_PER_USER, active, kind: "active_runs" });
    if (b.sessionKeyId) { const k = sk.get(u.id, b.sessionKeyId); if (k.status !== "active") throw new ApiErr(k.status === "revoked" ? "session_key_revoked" : k.status === "expired" ? "session_key_expired" : "session_key_missing", `Session key is ${k.status}.`); }
    const run = { id: newId("run", clock.now()), ownerId: u.id, strategyId: s.id, strategyVersion: ver.version, mode: b.mode, status: "starting" as const, startedAt: clock.now(), stoppedAt: null, startingEquity: Number(b.paper?.startingEquityUsd ?? "10000"), sessionKeyId: b.sessionKeyId, events: [], approvalMode: b.approvalMode, approvalTtlSec: b.approvalTtlSec };
    store.runs.set(run.id, run);
    const summary = { ...runs.summary(run), status: "starting" as const, lastSeq: 0 };
    runs.start(run, ver.strategy, () => geoGate(run.mode, u));
    store.audit.push({ at: clock.now(), userId: u.id, action: "run.start", target: run.id });
    return summary;
  };
  r.post("/runs", (c) => idem(c, async () => {
    const b = await body(c, A.StartRunReq); const summary = startRunFor(c.get("user"), b);
    return [summary, 201];
  }));
  r.get("/runs", (c) => {
    const q = query(c, PageQuery.extend({ strategyId: z.string().optional(), mode: z.enum(["paper", "testnet", "live"]).optional() })); const uid = c.get("user").id;
    const rows = [...store.runs.values()].filter((x) => x.ownerId === uid && (!q.strategyId || x.strategyId === q.strategyId) && (!q.mode || x.mode === q.mode));
    const p = paginate(rows, (x) => x.startedAt, q.limit, q.cursor); return c.json({ items: p.items.map((x) => runs.summary(x)), nextCursor: p.nextCursor });
  });
  r.get("/runs/:id", (c) => c.json(runs.summary(ownRun(c, c.req.param("id")))));
  r.post("/runs/:id/control", async (c) => {
    const run = ownRun(c, c.req.param("id")); const b = await body(c, A.RunControlReq);
    if (run.status === "stopped") throw new ApiErr("conflict", "Run already stopped.");
    await runs.control(run.id, b.action); store.audit.push({ at: clock.now(), userId: c.get("user").id, action: `run.${b.action}`, target: run.id });
    return c.json(runs.summary(run));
  });
  const closeRejected = new Map<string, number>(); // M5.3: `${runId}:${instrument}` -> last failed close
  // M4.1 partial close (paper only). Allowed while running, paused or halted: it only reduces risk.
  r.post("/runs/:id/positions/close", async (c) => {
    const run = ownRun(c, c.req.param("id")); const b = await body(c, A.ClosePositionReq);
    if (run.mode !== "paper") throw new ApiErr("mode_not_enabled", "Partial close is paper-only for now.");
    if (run.status === "stopped") throw new ApiErr("conflict", "Run already stopped.");
    const l = runs.live.get(run.id); const pos = l?.ex.acct.positions.get(b.instrument);
    if (!l || !pos) throw new ApiErr("not_found", "No open position in that instrument on this run.");
    const t = clock.now(); const mk = mkt.price(b.instrument, t)?.value ?? pos.avgEntry;
    const dust = Math.abs(pos.qty) * (1 - b.pct / 100) * mk < 1; const frac = dust ? 1 : b.pct / 100; // never leave < $1 behind
    const orderId = newId("ord", t);
    const evs = (await runs.closePartial(run.id, b.instrument, frac, orderId)) ?? [];
    const fill = evs.find((e): e is Extract<typeof e, { type: "fill" }> => e.type === "fill" && e.orderId === orderId) ?? null;
    const rej = evs.find((e) => (e.type === "rejected" || e.type === "error") && (e as { orderId?: string }).orderId === orderId) as { type: string; code: string; message: string } | undefined;
    const left = l.ex.acct.positions.get(b.instrument);
    if (!fill && left) closeRejected.set(`${run.id}:${b.instrument}`, t); // M5.3 makes it write-off eligible
    store.audit.push({ at: t, userId: c.get("user").id, action: "run.close_partial", target: `${run.id}:${b.instrument}:${b.pct}` });
    return c.json({ runId: run.id, orderId, instrument: b.instrument, requestedPct: b.pct, closedFully: !left, status: fill ? "filled" : rej?.type === "rejected" ? "rejected" : "error",
      fill, rejection: rej ? { code: rej.code, message: rej.message } : fill ? null : { code: "internal", message: "No fill was produced." }, remaining: left ? { qty: dec(left.qty, 8), avgEntry: dec(left.avgEntry, 6) } : null } satisfies z.infer<typeof A.ClosePositionRes>);
  });
  // M5.3 write-off of a stuck paper position. Only when it truly cannot be closed: no price, stale price, venue down,
  // or the last close attempt on it was rejected. Zero recovery, realized as a loss; requires confirm:true.
  const stuckFor = (runId: string, instrument: string) => {
    const t = clock.now(); const out: z.infer<typeof WO.StuckReason>[] = [];
    const px = mkt.price(instrument, t); if (!px) out.push("no_price"); else if (px.stale && px.staleReason !== "market_closed") out.push("price_stale"); // a normal session close is not "stuck"
    const m = registry.get(instrument); if (m && adapters[m.venue].status() === "down") out.push("venue_down");
    const rej = closeRejected.get(`${runId}:${instrument}`); if (rej && t - rej < 86_400_000) out.push("close_rejected");
    return out;
  };
  const writeOffPreview = (runId: string, instrument: string) => {
    const pos = runs.live.get(runId)?.ex.acct.positions.get(instrument); const reasons = pos ? stuckFor(runId, instrument) : [];
    const loss = pos ? (pos.kind === "perp" ? (Math.abs(pos.qty) * pos.avgEntry) / pos.leverage : Math.max(0, pos.qty * pos.avgEntry)) : null;
    return { runId, instrument, eligible: !!pos && reasons.length > 0, reasons,
      message: !pos ? "No open position in that instrument on this run." : reasons.length ? "This position can't be closed right now. Writing it off books the full amount as a paper loss." : "This position can still be closed normally; use close instead.",
      position: pos ? { qty: dec(pos.qty, 8), avgEntry: dec(pos.avgEntry, 6), kind: pos.kind } : null, basis: "zero_recovery" as const, lossUsd: loss === null ? null : dec(loss, 2) };
  };
  r.get("/runs/:id/positions/write-off", (c) => {
    const run = ownRun(c, c.req.param("id")); const q = query(c, z.object({ instrument: z.string().min(1).max(64) }));
    if (run.mode !== "paper") throw new ApiErr("mode_not_enabled", "Write-off is paper-only.");
    return c.json(writeOffPreview(run.id, q.instrument) satisfies z.infer<typeof WO.WriteOffPreviewRes>);
  });
  r.post("/runs/:id/positions/write-off", async (c) => {
    limit(`wo:${c.get("user").id}`, 10, 60_000); const run = ownRun(c, c.req.param("id")); const b = await body(c, WO.WriteOffReq);
    if (run.mode !== "paper") throw new ApiErr("mode_not_enabled", "Write-off is paper-only.");
    const pv = writeOffPreview(run.id, b.instrument);
    if (!pv.position) throw new ApiErr("not_found", pv.message);
    if (!pv.eligible) throw new ApiErr("conflict", pv.message, { reasons: [] });
    const res = await runs.writeOff(run.id, b.instrument, `Stuck position ${b.instrument} (${pv.reasons.join(", ")}).`);
    if (!res) throw new ApiErr("not_found", "No open position in that instrument on this run.");
    closeRejected.delete(`${run.id}:${b.instrument}`);
    const t = clock.now(); store.audit.push({ at: t, userId: c.get("user").id, action: "run.write_off", target: `${run.id}:${b.instrument}:${res.lossUsd.toFixed(2)}` });
    return c.json({ runId: run.id, instrument: b.instrument, writtenOff: true, reasons: pv.reasons, qty: dec(res.qty, 8), avgEntry: dec(res.avgEntry, 6), lossUsd: dec(res.lossUsd, 2), basis: "zero_recovery", at: iso(t) } satisfies z.infer<typeof WO.WriteOffRes>);
  });
  // ---- M4.2 approvals ----
  // M4.6 names: a run shows the name of the strategy version it runs; a bare strategy id shows the current name.
  const stratName = (sid: string | null | undefined) => { const s = sid ? store.strategies.get(sid) : undefined; return s ? s.versions.at(-1)!.strategy.name : null; };
  const runStratName = (runId: string | null | undefined) => { const r = runId ? store.runs.get(runId) : undefined; if (!r) return null; const s = store.strategies.get(r.strategyId);
    return s ? (s.versions.find((v) => v.version === r.strategyVersion) ?? s.versions.at(-1)!).strategy.name : null; };
  const actionTitle = (x: ApprovalRec) => sharedTitle(x, registry);
  const apvConflict = (run: import("../store").RunRow) => { const l = runs.live.get(run.id);
    const runStatus = run.status === "paused" || run.status === "halted" || run.status === "stopped" ? run.status : l?.ex.halted ? "halted" as const : "aborted" as const;
    const h = runStatus === "halted" ? [...run.events].reverse().find((e) => e.type === "risk_halt") as { rule: string; message: string } | undefined : undefined;
    const details: z.infer<typeof A.ApproveConflictDetails> = h ? { runStatus, haltReason: `${h.rule}: ${h.message}` } : { runStatus };
    return new ApiErr("conflict", `Run is ${runStatus}; resume it before approving.`, details); };
  const apvView = (runId: string, x: ApprovalRec): z.infer<typeof A.Approval> => ({ id: x.id, runId, orderId: x.orderId, actionId: x.action.id,
    strategyId: store.runs.get(runId)!.strategyId as z.infer<typeof A.Approval>["strategyId"], strategyName: runStratName(runId) ?? "", actionTitle: actionTitle(x), instrument: x.instrument as z.infer<typeof A.Approval>["instrument"], venue: x.venue as z.infer<typeof A.Approval>["venue"], side: x.side, notionalUsd: dec(x.notional, 2),
    status: x.status, createdAt: new Date(x.createdAt).toISOString(), expiresAt: new Date(x.expiresAt).toISOString(), resolvedAt: x.resolvedAt === null ? null : new Date(x.resolvedAt).toISOString(), result: x.result });
  const findApv = (uid: string, id: string) => { for (const run of store.runs.values()) { if (run.ownerId !== uid) continue; const x = runs.approvalsOf(run.id).get(id); if (x) return { run, x }; } throw new ApiErr("not_found", "Approval not found."); };
  r.get("/approvals", (c) => {
    const q = query(c, A.ApprovalsQuery); const uid = c.get("user").id; const rows: { id: string; runId: string; x: ApprovalRec }[] = [];
    for (const run of store.runs.values()) { if (run.ownerId !== uid || (q.runId && run.id !== q.runId)) continue; runs.sweepApprovals(run.id); for (const x of runs.approvalsOf(run.id).values()) if (!q.status || x.status === q.status) rows.push({ id: x.id, runId: run.id, x }); }
    const p = paginate(rows, (r) => r.x.createdAt, q.limit, q.cursor); return c.json({ items: p.items.map((r) => apvView(r.runId, r.x)), nextCursor: p.nextCursor });
  });
  r.get("/approvals/:id", (c) => { const { run, x } = findApv(c.get("user").id, c.req.param("id")); runs.sweepApprovals(run.id); return c.json(apvView(run.id, x)); });
  r.post("/approvals/:id", async (c) => {
    const { run, x } = findApv(c.get("user").id, c.req.param("id")); const b = await body(c, A.DecideApprovalReq);
    if (b.decision === "approve" && (run.status === "paused" || run.status === "halted")) throw apvConflict(run);
    const res = await runs.decideApproval(run.id, x.id, b.decision);
    if (res === "run_not_active") throw apvConflict(run);
    if (res !== "ok") throw new ApiErr("conflict", `Approval is ${x.status}.`);
    store.audit.push({ at: clock.now(), userId: c.get("user").id, action: `approval.${b.decision}`, target: `${run.id}:${x.id}` });
    return c.json(apvView(run.id, x));
  });
  r.get("/runs/:id/events", (c) => {
    if (isSseReq(c)) return sseRun(c); // alias of /events/stream (SSE) when ?ticket= or Accept: text/event-stream
    const run = ownRun(c, c.req.param("id")); const q = query(c, z.object({ since: z.coerce.number().int().min(-1).default(-1), limit: z.coerce.number().int().min(1).max(500).default(100) }));
    const items = run.events.filter((e) => e.seq > q.since).slice(0, q.limit);
    const more = run.events.length > 0 && items.length > 0 && items.at(-1)!.seq < run.events.length - 1;
    return c.json({ items, nextCursor: more ? String(items.at(-1)!.seq) : null });
  });
  r.get("/fills", (c) => {
    const q = query(c, A.FillsQuery); const uid = c.get("user").id;
    const all = [...store.runs.values()].filter((x) => x.ownerId === uid && (!q.runId || x.id === q.runId) && (!q.mode || x.mode === q.mode)).flatMap((x) => x.events.filter((e) => e.type === "fill").map((e) => ({ ...e, id: (e as any).fillId })));
    const p = paginate(all as any[], (x) => Date.parse(x.ts), q.limit, q.cursor); return c.json({ items: p.items.map(({ id: _id, ...e }: any) => e), nextCursor: p.nextCursor });
  });

  // ---------- session keys ----------
  const skWrap = <T>(fn: () => T | Promise<T>) => Promise.resolve().then(fn).catch((e) => { if (e instanceof SessionKeyError) throw new ApiErr(e.code, e.message); throw e; });
  // ---------- M4.0 alerts ----------
  r.get("/alerts/settings", (c) => c.json(alerts.settings(c.get("user").id)));
  r.put("/alerts/settings", async (c) => {
    const b = await body(c, AL.PutAlertSettingsReq); const uid = c.get("user").id;
    let secret: string | null; try { secret = await alerts.setWebhook(uid, b.webhookUrl, b.rotateSecret); } catch (e) { if (e instanceof UrlBlocked) throw new ApiErr("alert_url_blocked", e.message); throw e; }
    return c.json({ ...alerts.settings(uid), signingSecret: secret });
  });
  r.get("/alerts/rules", (c) => { const uid = c.get("user").id; return c.json({ items: [...alerts.rules.values()].filter((x) => x.ownerId === uid).sort((a, b) => a.createdAt - b.createdAt).map(alerts.ruleView) }); });
  r.post("/alerts/rules", async (c) => {
    const b = await body(c, AL.CreateAlertRuleReq); const uid = c.get("user").id;
    if (b.runId) { const run = store.runs.get(b.runId); if (!run || run.ownerId !== uid) throw new ApiErr("not_found", "Run not found."); }
    const row = alerts.addRule(uid, b); if (!row) throw new ApiErr("limit_exceeded", "Too many alert rules (max 20).", undefined, DEFAULT_RETRY_AFTER_SEC);
    return c.json(alerts.ruleView(row), 201);
  });
  r.delete("/alerts/rules/:id", (c) => { const x = alerts.rules.get(c.req.param("id")); if (!x || x.ownerId !== c.get("user").id) throw new ApiErr("not_found", "Rule not found."); alerts.rules.delete(x.id); return c.body(null, 204); });
  r.get("/alerts/deliveries", (c) => { const q = query(c, PageQuery); const uid = c.get("user").id; const p = paginate([...alerts.deliveries.values()].filter((x) => x.ownerId === uid), (x) => x.createdAt, q.limit, q.cursor); return c.json({ items: p.items.map(alerts.deliveryView), nextCursor: p.nextCursor }); });
  r.post("/alerts/test", async (c) => { const uid = c.get("user").id; const [d, ...rest] = alerts.enqueueAll(uid, null, null, "test", null, "Test alert from Quiver."); await alerts.deliverNow(d.id); for (const x of rest) await alerts.deliverNow(x.id); return c.json(alerts.deliveryView(d), 202); });
  // ---------- M5.9 user-supplied RPC endpoints + AI keys (write-only) ----------
  const secView = (x: import("../store").UserSecretRow): z.infer<typeof SE.UserSecretView> => ({ id: x.id, kind: x.kind, chainId: x.chainId, provider: x.provider, label: x.label, hint: x.hint,
    status: vault.open(x.sealed, aadOf(x)) === null ? "undecryptable" : "ok", createdAt: iso(x.createdAt), updatedAt: iso(x.updatedAt), lastUsedAt: x.lastUsedAt ? iso(x.lastUsedAt) : null });
  const upsertSecret = (uid: string, kind: "rpc" | "ai_key", match: (x: import("../store").UserSecretRow) => boolean, f: { chainId: number | null; provider: string | null; label: string; hint: string; plain: string }) => {
    if (!vault.available) throw new ApiErr("secrets_unavailable", "Saving your own endpoints and keys isn't enabled on this server yet.");
    const mine = [...store.userSecrets.values()].filter((x) => x.ownerId === uid); let x = mine.find((y) => y.kind === kind && match(y));
    if (!x && mine.length >= SE.MAX_SECRETS_PER_USER) throw new ApiErr("limit_exceeded", "Too many saved secrets.", undefined, DEFAULT_RETRY_AFTER_SEC);
    const now = clock.now(); if (!x) { x = { id: newId("sec", now), ownerId: uid, kind, chainId: f.chainId, provider: f.provider, label: "", hint: "", sealed: "", createdAt: now, updatedAt: now, lastUsedAt: null }; store.userSecrets.set(x.id, x); }
    Object.assign(x, { label: f.label, hint: f.hint, updatedAt: now, sealed: vault.seal(f.plain, aadOf(x)) });
    store.audit.push({ at: now, userId: uid, action: `secret.${kind}.put`, target: x.id }); return x;
  };
  /** M5.10 (INFO): the only way to use a stored RPC URL. Re-runs the URL shape + DNS SSRF checks at fetch time and returns the
   *  vetted address to pin the connection to (defeats DNS rebinding between save and use). M5.13: used by GET /chain/testnet/accounts. */
  const userRpcFor = async (uid: string, chainId: number): Promise<{ url: string; address: string; family: number } | null> => {
    const x = [...store.userSecrets.values()].find((y) => y.ownerId === uid && y.kind === "rpc" && y.chainId === chainId); if (!x) return null;
    const plain = vault.open(x.sealed, aadOf(x)); if (plain === null) return null;
    let u: URL; let a: { address: string; family: number }; try { u = checkUrlShape(plain); a = await resolvePublic(u, o.alertResolver ?? systemResolver); } catch (e) { if (e instanceof UrlBlocked) throw new ApiErr("rpc_url_blocked", e.message.replace(/Webhook/g, "RPC")); throw e; }
    x.lastUsedAt = clock.now(); return { url: u.toString(), ...a };
  };
  r.get("/me/secrets", (c) => { const uid = c.get("user").id; return c.json(SE.UserSecretList.parse({ vault: vault.available ? "ok" : "unavailable", items: [...store.userSecrets.values()].filter((x) => x.ownerId === uid).sort((a, b) => a.createdAt - b.createdAt).map(secView) })); });
  r.put("/me/secrets/rpc", async (c) => {
    const uid = c.get("user").id; limit(`sec:${uid}`, 10, 60_000); const b = await body(c, SE.PutRpcSecretReq);
    if (!vault.available) throw new ApiErr("secrets_unavailable", "Saving your own endpoints and keys isn't enabled on this server yet.");
    let u: URL; try { u = checkUrlShape(b.url); await resolvePublic(u, o.alertResolver ?? systemResolver); } catch (e) { if (e instanceof UrlBlocked) throw new ApiErr("rpc_url_blocked", e.message.replace(/Webhook/g, "RPC")); throw e; }
    const x = upsertSecret(uid, "rpc", (y) => y.chainId === b.chainId, { chainId: b.chainId, provider: null, label: b.label || `Chain ${b.chainId} RPC`, hint: `https://${u.host}/…`, plain: u.toString() });
    return c.json(SE.UserSecretView.parse(secView(x)));
  });
  r.put("/me/secrets/ai", async (c) => {
    const uid = c.get("user").id; limit(`sec:${uid}`, 10, 60_000); const b = await body(c, SE.PutAiKeySecretReq);
    const x = upsertSecret(uid, "ai_key", (y) => y.provider === b.provider, { chainId: null, provider: b.provider, label: b.label || "OpenRouter key", hint: `sk-or-…${b.apiKey.slice(-4)}`, plain: b.apiKey });
    return c.json(SE.UserSecretView.parse(secView(x)));
  });
  r.delete("/me/secrets/:id", (c) => { const uid = c.get("user").id; const x = store.userSecrets.get(c.req.param("id")); if (!x || x.ownerId !== uid) throw new ApiErr("not_found", "Secret not found.");
    store.userSecrets.delete(x.id); store.audit.push({ at: clock.now(), userId: uid, action: `secret.${x.kind}.delete`, target: x.id }); return c.body(null, 204); });
  // ---------- M5.8 chat alert channels (Telegram / X stubs) ----------
  r.get("/alerts/channels", (c) => { const u = alerts.users.get(c.get("user").id); return c.json(AL.AlertChannelList.parse({ items: [...alerts.channels.values()].map((a) => channelView(a, u, alerts.provider.name)) })); });
  r.put("/alerts/channels/:name", async (c) => {
    const n = AL.AlertChannelName.safeParse(c.req.param("name")); const a = n.success ? alerts.channels.get(n.data) : undefined; if (!a) throw new ApiErr("not_found", "Unknown alert channel.");
    const b = await body(c, AL.PutAlertChannelReq); const uid = c.get("user").id; const u = alerts.users.get(uid) ?? { webhookUrl: null, secret: null };
    const t = b.target === null ? null : a.normalizeTarget(b.target); if (b.target !== null && !t) throw new ApiErr("validation_failed", `Enter a valid ${a.label} destination: ${a.targetHint}.`, { field: "target" });
    u.targets = { ...u.targets }; if (t) u.targets[a.name] = t; else delete u.targets[a.name]; alerts.users.set(uid, u);
    store.audit.push({ at: clock.now(), userId: uid, action: "alerts.channel", target: `${a.name}:${t ? "set" : "cleared"}` });
    return c.json(AL.AlertChannel.parse(channelView(a, u, alerts.provider.name)));
  });
  // ---------- M5.0: read-only testnet 46630 adapter (no writes, no signing) ----------
  const chainReader = o.chainReader !== undefined ? o.chainReader : cfg.CHAIN_READS_ENABLED ? new ChainReader({ chainId: 46630, rpcUrl: cfg.TESTNET_RPC_URL, timeoutMs: cfg.CHAIN_READ_TIMEOUT_MS, expectedCodeHash: (cfg.TESTNET_SESSION_ACCOUNT_CODEHASH as `0x${string}` | undefined) ?? null }) : null;
  const tv = o.testnetVerified ?? VerifiedReg.load("config/verified/46630.json");
  let chainStatusCache: { at: number; res: ChainStatusRes } | null = null;
  r.get("/chain/testnet/status", async (c) => {
    if (chainStatusCache && clock.now() - chainStatusCache.at < 10_000) return c.json(chainStatusCache.res);
    const exec = testnetExecutionStatus(tv); const reasons: string[] = [];
    let st = { reachable: false, chainIdMatches: null as boolean | null, blockNumber: null as string | null };
    if (!chainReader) reasons.push("Chain reads are off (CHAIN_READS_ENABLED=false).");
    else { const s0 = await chainReader.status(); st = s0; if (s0.reason) reasons.push(s0.reason); }
    if (exec.reason) reasons.push(exec.reason); if (tv.error) reasons.push(`verification file: ${tv.error}`);
    const res: ChainStatusRes = { enabled: !!chainReader, chainId: chainReader?.chainId ?? 46630, network: (chainReader?.chainId ?? 46630) === 46630 ? "robinhood-testnet" : "anvil", readOnly: true, ...st, tradable: false,
      verification: (tv.file?.items ?? []).map((i) => ({ id: i.id, status: i.status })), reasons, checkedAt: iso(clock.now()) };
    chainStatusCache = { at: clock.now(), res }; return c.json(res);
  });
  const rpcPost = o.rpcPost ?? nodeRpcPost();
  r.get("/chain/testnet/accounts/:address", async (c) => {
    const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).safeParse(c.req.param("address"));
    const key = c.req.query("sessionKey"); const toks = (c.req.query("tokens") ?? "").split(",").filter(Boolean);
    const A40 = /^0x[0-9a-fA-F]{40}$/;
    if (!addr.success || (key && !A40.test(key)) || toks.length > 8 || toks.some((t) => !A40.test(t))) throw new ApiErr("validation_failed", "Use 0x addresses (up to 8 tokens).");
    // M5.13: a stored per-user RPC for 46630 wins. userRpcFor re-checks SSRF now; the reader connects only to the vetted IP.
    const mine = await userRpcFor(c.get("user").id, 46630);
    const reader = mine ? new ChainReader({ chainId: 46630, timeoutMs: cfg.CHAIN_READ_TIMEOUT_MS, expectedCodeHash: (cfg.TESTNET_SESSION_ACCOUNT_CODEHASH as `0x${string}` | undefined) ?? null, transport: pinnedTransport(mine, rpcPost, cfg.CHAIN_READ_TIMEOUT_MS) }) : chainReader;
    if (!reader) throw new ApiErr("venue_unavailable", "Chain reads are off on this server.");
    c.header("x-quiver-rpc", mine ? "user" : "server");
    try { return c.json(await reader.account(getAddress(addr.data), { sessionKey: key ? getAddress(key) : undefined, tokens: toks.map((t) => getAddress(t)) })); } // M5.10: EIP-55 in and out
    catch (e) { throw new ApiErr("venue_unavailable", e instanceof ChainMismatch ? "The testnet node reports the wrong chain; reads are refused." : "The testnet RPC is unreachable. Try again later."); }
  });
  // M5.23/M5.24d: shared read-only 46630 reader (eth_call/getCode only). Built when injected, when TEST_POOL_RPC_URL is set,
  // in testnet mode, or (force) for an enabled test pool. Returns null when unreachable or not on 46630.
  let tpReader: PoolReader | null = null; let tpChainOk: Promise<boolean> | null = null;
  const tpExpect = o.testPool?.expectChainId ?? 46630;
  const reader46630 = async (force = false): Promise<PoolReader | null> => {
    if (!tpReader) { if (!(o.testPool?.reader || force || cfg.TEST_POOL_RPC_URL || cfg.QUIVR_MODE === "testnet")) return null; tpReader = o.testPool?.reader ?? defaultReader(cfg); }
    tpChainOk ??= tpReader.getChainId().then((id) => id === tpExpect).catch(() => { tpChainOk = null; return false; });
    return (await tpChainOk) ? tpReader : null;
  };
  // ---------- M5.23: testnet-46630-only deposit prepare (unsigned tx; the user's wallet signs and sends) ----------
  const TUSDG = cfg.TEST_USDG_ADDRESS ? getAddress(cfg.TEST_USDG_ADDRESS) : null;
  const TNVDA = cfg.TEST_NVDA_ADDRESS ? getAddress(cfg.TEST_NVDA_ADDRESS) : null;
  const DEPOSIT_MAX = { ETH: 1, tUSDG: 1_000_000, tNVDA: 10_000 } as const;
  const DEPOSIT_NOTICE = "Testnet 46630 only. Test assets have no value. Your wallet signs and sends this; Quiver never signs or holds keys.";
  r.post("/testnet/deposit/prepare", async (c) => {
    const u = c.get("user"); limit(`dep:${u.id}`, 20, 60_000);
    const b = await body(c, TN.DepositPrepareReq);
    if (b.chainId !== TN.TESTNET_CHAIN_ID || cfg.QUIVR_MODE === "mainnet") throw new ApiErr("validation_failed", "Deposits can only be prepared on Robinhood Chain testnet (46630).", { reason: "chain_not_allowed" });
    // M5.26/M5.28: amount checked first (before wallet/smart-account lookups); caps compare in bigint base units (Number() rounds 1 ETH + 1 wei down to 1).
    { const d0 = b.asset === "tUSDG" ? 6 : 18;
      if ((b.amount.split(".")[1]?.length ?? 0) > d0) throw new ApiErr("validation_failed", `${b.asset} has ${d0} decimals.`, { reason: "too_many_decimals" });
      const u0 = parseUnits(b.amount, d0);
      if (u0 <= 0n || u0 > parseUnits(String(DEPOSIT_MAX[b.asset]), d0)) throw new ApiErr("validation_failed", `Amount must be above 0 and at most ${DEPOSIT_MAX[b.asset]} ${b.asset}.`, { reason: "amount_out_of_range" }); }
    const from = getAddress(b.from);
    if (!(u.linkedWallets ?? []).some((w) => w.address.toLowerCase() === from.toLowerCase())) throw new ApiErr("conflict", "Link this wallet to your account first.", { reason: "wallet_not_linked" });
    const sk = [...store.sessionKeys.values()].filter((k) => k.ownerId === u.id && k.policy.chainId === 46630 && (k.status === "active" || k.status === "pending")).sort((a, b2) => b2.createdAt - a.createdAt)[0];
    if (!sk) throw new ApiErr("conflict", "Set up a testnet session account first (Go live → testnet).", { reason: "no_smart_account" });
    const recipient = getAddress(sk.smartAccount); const dec = b.asset === "tUSDG" ? 6 : 18; const tokenAddr = b.asset === "tUSDG" ? TUSDG : b.asset === "tNVDA" ? TNVDA : null;
    // M5.24d: when a 46630 RPC is available, the smart account must already have code (else funds would sit at an undeployed address).
    let recipientCode: "verified" | "unchecked" = "unchecked";
    // M5.25: fail closed. RPC configured but lookup fails (error, unreachable, wrong chain) → 503; "unchecked" only with no RPC configured.
    const rpcConfigured = !!(o.testPool?.reader || cfg.TEST_POOL_RPC_URL || cfg.QUIVR_MODE === "testnet");
    if (rpcConfigured) { const rd46 = await reader46630();
      const code = rd46?.getCode ? await rd46.getCode({ address: recipient }).catch(() => null) : null;
      if (code === null) throw new ApiErr("venue_unavailable", "Can't confirm your session account on testnet right now. Try again shortly.", { reason: "recipient_check_unavailable" });
      { if (!code || code === "0x") throw new ApiErr("conflict", "Your session account isn't deployed on testnet yet. Finish Go live → testnet setup, then deposit.", { reason: "smart_account_not_deployed", recipient }); recipientCode = "verified"; } }
    if ((b.amount.split(".")[1]?.length ?? 0) > dec) throw new ApiErr("validation_failed", `${b.asset} has ${dec} decimals.`, { reason: "too_many_decimals" });
    const units = parseUnits(b.amount, dec);
    let tx: TN.UnsignedTx;
    if (b.asset === "ETH") tx = { chainId: 46630, from, to: recipient, data: "0x", value: units.toString() };
    else { if (!tokenAddr) throw new ApiErr("venue_unavailable", `${b.asset} isn't configured on this server yet.`);
      tx = { chainId: 46630, from, to: tokenAddr, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, units] }).toLowerCase() }; }
    store.audit.push({ at: clock.now(), userId: u.id, action: "testnet.deposit.prepare", target: `${b.asset}:${b.amount}` });
    return c.json({ tx, asset: b.asset, amount: b.amount, amountBaseUnits: units.toString(), decimals: dec, recipient, recipientCode, token: tokenAddr,
      humanReadable: `Send ${b.amount} ${b.asset} on testnet 46630 from ${from} to your Quiver session account ${recipient}.`, testnet: true, preparedAt: iso(clock.now()), notice: DEPOSIT_NOTICE } satisfies TN.DepositPrepareRes);
  });
  // ---------- M5.23 Slice 3: our own test pool on 46630 (read-only quotes; swap = unsigned txs) ----------
  const tp = testPoolState(cfg); const TP_NOTICE = "Test pool on Robinhood Chain testnet 46630. Test tokens only, no real value. Your wallet signs; Quiver never does.";
  const tpDec = new Map<string, number>();
  const pool = async () => {
    if (!tp.enabled || cfg.QUIVR_MODE === "mainnet") throw new ApiErr("venue_unavailable", "The test pool isn't configured on this server.", { missing: tp.missing });
    const rr = await reader46630(true); if (!rr) throw new ApiErr("venue_unavailable", "Test pool RPC is unreachable or not on testnet 46630.");
    return rr;
  };
  const rd = (rr: PoolReader, address: string, abi: any, functionName: string, args: readonly unknown[] = []) =>
    rr.readContract({ address: address as `0x${string}`, abi, functionName, args }).catch(() => { throw new ApiErr("quote_unavailable", "Couldn't read the test pool right now."); });
  const tpDecOf = async (rr: PoolReader, t: string) => { if (!tpDec.has(t)) tpDec.set(t, Number(await rd(rr, t, ERC20_RO, "decimals"))); return tpDec.get(t)!; };
  const SWAP_MAX = { buy: 1_000_000, sell: 10_000 } as const;
  const tpQuote = async (side: "buy" | "sell", amount: string) => {
    const rr = await pool(); const [tin, tout] = side === "buy" ? [tp.usdg!, tp.nvda!] : [tp.nvda!, tp.usdg!];
    const [di, dout] = [await tpDecOf(rr, tin), await tpDecOf(rr, tout)];
    if ((amount.split(".")[1]?.length ?? 0) > di) throw new ApiErr("validation_failed", `Too many decimals (max ${di}).`, { reason: "too_many_decimals" });
    const units = parseUnits(amount, di); if (units === 0n) throw new ApiErr("validation_failed", "Amount must be above 0.", { reason: "amount_out_of_range" });
    // M5.26: swap input caps in base units (buy: tUSDG in, sell: tNVDA in).
    if (units > parseUnits(String(SWAP_MAX[side]), di)) throw new ApiErr("validation_failed", `Amount must be at most ${SWAP_MAX[side]} ${side === "buy" ? "tUSDG" : "tNVDA"}.`, { reason: "amount_out_of_range" });
    const t0 = getAddress(String(await rd(rr, tp.pool!, POOL_ABI, "token0")));
    const [r0, r1] = [BigInt(String(await rd(rr, tp.pool!, POOL_ABI, "reserve0"))), BigInt(String(await rd(rr, tp.pool!, POOL_ABI, "reserve1")))];
    const [ru, rn] = t0 === tp.usdg ? [r0, r1] : [r1, r0];
    const out = BigInt(String(await rd(rr, tp.pool!, POOL_ABI, "quote", [tin, units])));
    if (out === 0n) throw new ApiErr("quote_unavailable", "Amount too small or pool has no liquidity.");
    const [ud, nd] = side === "buy" ? [di, dout] : [dout, di];
    const price = rn === 0n ? "0" : (Number(formatUnits(ru, ud)) / Number(formatUnits(rn, nd))).toFixed(6);
    return { side, tokenIn: tin, tokenOut: tout, symbolIn: side === "buy" ? "tUSDG" : "tNVDA", symbolOut: side === "buy" ? "tNVDA" : "tUSDG",
      amountIn: amount, amountInUnits: units.toString(), amountOut: formatUnits(out, dout), amountOutUnits: out.toString(), priceUsdgPerNvda: price, feeBps: 30 as const,
      reserves: { usdg: ru.toString(), nvda: rn.toString() }, quotedAt: iso(clock.now()), testnet: true as const } satisfies TN.TestPoolQuoteRes;
  };
  app.get("/testpool/status", (c) => { pubLimit(c, "tps", 60);
    return c.json({ enabled: tp.enabled && cfg.QUIVR_MODE !== "mainnet", chainId: 46630, pool: tp.pool, usdg: tp.usdg, nvda: tp.nvda, missing: tp.missing, notice: TP_NOTICE } satisfies TN.TestPoolStatusRes); });
  r.get("/testpool/quote", async (c) => { const u = c.get("user"); limit(`tpq:${u.id}`, 60, 60_000);
    const q = await query(c, TN.TestPoolQuoteQuery); return c.json(await tpQuote(q.side, q.amount)); });
  r.post("/testpool/swap/prepare", async (c) => {
    const u = c.get("user"); limit(`tpsw:${u.id}`, 20, 60_000);
    const b = await body(c, TN.TestPoolSwapPrepareReq);
    if (b.chainId !== 46630) throw new ApiErr("validation_failed", "Swaps can only be prepared on Robinhood Chain testnet (46630).", { reason: "chain_not_allowed" });
    const from = getAddress(b.from);
    if (!(u.linkedWallets ?? []).some((w) => w.address.toLowerCase() === from.toLowerCase())) throw new ApiErr("conflict", "Link this wallet to your account first.", { reason: "wallet_not_linked" });
    const qt = await tpQuote(b.side, b.amount); const rr = await pool();
    const units = BigInt(qt.amountInUnits); const minOut = (BigInt(qt.amountOutUnits) * BigInt(10_000 - b.slippageBps)) / 10_000n;
    const deadline = Math.floor(clock.now() / 1000) + b.deadlineSec;
    // M5.24e: the user's wallet must hold the input amount (read-only balanceOf), else 422 insufficient_balance.
    const bal = BigInt(String(await rd(rr, qt.tokenIn, ERC20_RO, "balanceOf", [from])));
    if (bal < units) { const di = await tpDecOf(rr, qt.tokenIn); throw new ApiErr("insufficient_balance", `Your wallet has ${formatUnits(bal, di)} ${qt.symbolIn}; this swap needs ${qt.amountIn}.`, { token: qt.tokenIn, symbol: qt.symbolIn, have: formatUnits(bal, di), need: qt.amountIn, haveUnits: bal.toString(), needUnits: units.toString() }); }
    const allowance = BigInt(String(await rd(rr, qt.tokenIn, ERC20_RO, "allowance", [from, tp.pool!])));
    const outDec = await tpDecOf(rr, qt.tokenOut);
    const txs: TN.TestPoolSwapPrepareRes["txs"] = [];
    if (allowance < units) txs.push({ kind: "approve", description: `Allow the test pool to spend ${qt.amountIn} ${qt.symbolIn}.`,
      tx: { chainId: 46630, from, to: qt.tokenIn, value: "0", data: encodeFunctionData({ abi: ERC20_RO, functionName: "approve", args: [tp.pool! as `0x${string}`, units] }).toLowerCase() } });
    txs.push({ kind: "swap", description: `Swap ${qt.amountIn} ${qt.symbolIn} for at least ${formatUnits(minOut, outDec)} ${qt.symbolOut}.`,
      tx: { chainId: 46630, from, to: tp.pool!, value: "0", data: encodeFunctionData({ abi: POOL_ABI, functionName: "swapExactIn", args: [qt.tokenIn as `0x${string}`, units, minOut, from, BigInt(deadline)] }).toLowerCase() } });
    store.audit.push({ at: clock.now(), userId: u.id, action: "testpool.swap.prepare", target: `${b.side}:${b.amount}` });
    return c.json({ txs, quote: qt, minAmountOut: formatUnits(minOut, outDec), minAmountOutUnits: minOut.toString(), slippageBps: b.slippageBps, deadline, testnet: true, notice: TP_NOTICE } satisfies TN.TestPoolSwapPrepareRes);
  });
  // ---------- M5.2: wallet-link scaffold (EIP-191 personal_sign; server only verifies, never signs) ----------
  const linkChallenges = new Map<string, { userId: string; address: string; message: string; exp: number }>();
  // M5.11: fail closed: no SIWE_ORIGIN -> wallet linking is off (503), unless mock mode + SIWE_DEV_LOCALHOST=true.
  const siweOrigin = cfg.SIWE_ORIGIN ?? (cfg.QUIVR_MODE === "mock" && cfg.SIWE_DEV_LOCALHOST ? "http://localhost:3000" : null);
  const SIWE_URI = siweOrigin ? new URL(siweOrigin).origin : ""; const SIWE_DOMAIN = siweOrigin ? new URL(siweOrigin).host : ""; const SIWE_CHAIN = 46630;
  const needSiwe = () => { if (!siweOrigin) throw new ApiErr("wallet_link_unavailable", "Wallet linking isn't configured on this server yet."); };
  /** M5.10: a wallet links to at most one account (its primary wallet or any linked wallet). */
  const walletFree = (addr: string, uid: string) => { const a = addr.toLowerCase();
    for (const x of store.users.values()) if (x.id !== uid && (x.wallet.toLowerCase() === a || (x.linkedWallets ?? []).some((w) => w.address.toLowerCase() === a))) throw new ApiErr("conflict", "This wallet is already linked to another account.", { reason: "wallet_in_use" }); };
  const walletsView = (u: User) => ({ items: (u.linkedWallets ?? []).map((w) => ({ address: w.address, linkedAt: iso(w.linkedAt), primary: w.address.toLowerCase() === u.wallet.toLowerCase() })) });
  r.post("/wallets/link/challenge", async (c) => { needSiwe();
    const b = await body(c, AU.WalletLinkChallengeReq); const u = c.get("user"); limit(`wl:${u.id}`, 10, 60_000);
    for (const [k, v] of linkChallenges) if (v.exp < clock.now() || v.userId === u.id) linkChallenges.delete(k); // one live challenge per user
    const address = getAddress(b.address); walletFree(address, u.id);
    const nonce = randomBytes(16).toString("hex"); const exp = clock.now() + 5 * 60_000;
    // M5.10: EIP-4361 (SIWE) message, bound to this server's domain, chain 46630, single-use nonce and expiry.
    const message = `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n${address}\n\nLink this wallet to your Quiver account. This signature only proves you own the wallet. It does not move funds or approve anything.\n\nURI: ${SIWE_URI}\nVersion: 1\nChain ID: ${SIWE_CHAIN}\nNonce: ${nonce}\nIssued At: ${iso(clock.now())}\nExpiration Time: ${iso(exp)}\nRequest ID: ${u.id}`;
    linkChallenges.set(nonce, { userId: u.id, address, message, exp });
    return c.json({ nonce, message, expiresAt: iso(exp), domain: SIWE_DOMAIN, uri: SIWE_URI, chainId: SIWE_CHAIN, version: "1" as const });
  });
  r.post("/wallets/link/verify", async (c) => { needSiwe();
    const b = await body(c, AU.WalletLinkVerifyReq); const u = c.get("user"); const ch = linkChallenges.get(b.nonce);
    if (!ch || ch.userId !== u.id || ch.exp < clock.now()) throw new ApiErr("wallet_link_invalid", "This link request expired. Start again.");
    linkChallenges.delete(b.nonce); // single use, even on a bad signature
    let ok: boolean; try { ok = isLowS(b.signature) && await verifyMessage({ address: ch.address as `0x${string}`, message: ch.message, signature: b.signature as `0x${string}` }); } catch { ok = false; }
    if (!ok) throw new ApiErr("wallet_link_invalid", "The signature doesn't match this wallet.");
    walletFree(ch.address, u.id); const list = (u.linkedWallets ??= []);
    if (!list.some((w) => w.address === ch.address)) { if (list.length >= MAX_WALLETS) throw new ApiErr("limit_exceeded", `Up to ${MAX_WALLETS} wallets.`); list.push({ address: ch.address, linkedAt: clock.now() }); }
    store.audit.push({ at: clock.now(), userId: u.id, action: "wallet.link" });
    return c.json(walletsView(u));
  });
  r.get("/me/wallets", (c) => c.json(walletsView(c.get("user"))));
  r.delete("/me/wallets/:address", (c) => {
    const u = c.get("user"); const a = c.req.param("address").toLowerCase(); const before = (u.linkedWallets ?? []).length;
    u.linkedWallets = (u.linkedWallets ?? []).filter((w) => w.address.toLowerCase() !== a);
    if (u.linkedWallets.length === before) throw new ApiErr("not_found", "Wallet not linked.");
    return c.json(walletsView(u));
  });
  r.post("/session-keys/prepare", async (c) => { const b = await body(c, A.PrepareSessionKeyReq); const u = c.get("user"); return c.json(await skWrap(() => sk.prepare(u.id, u.wallet, b))); });
  r.post("/session-keys/submit", async (c) => { const b = await body(c, A.SubmitSessionKeyReq); const u = c.get("user"); return c.json(await skWrap(() => sk.submit(u.id, u.wallet, b.sessionKeyId, b.signature, b.policyHash, b.installTxHash))); });
  r.get("/session-keys/defaults", (c) => c.json(sk.defaults()));
  r.get("/session-keys", (c) => { const q = query(c, PageQuery); const uid = c.get("user").id; const rows = [...store.sessionKeys.values()].filter((x) => x.ownerId === uid); rows.forEach((x) => sk.refresh(x)); const p = paginate(rows, (x) => x.createdAt, q.limit, q.cursor); return c.json({ items: p.items.map((x) => sk.view(x)), nextCursor: p.nextCursor }); });
  r.get("/session-keys/:id", async (c) => c.json(await skWrap(() => sk.view(sk.get(c.get("user").id, c.req.param("id"))))));
  r.delete("/session-keys/:id", async (c) => {
    const u = c.get("user"); const out = await skWrap(() => sk.revoke(u.id, c.req.param("id")));
    for (const l of runs.live.values()) if (l.run.sessionKeyId === out.sessionKey.id) runs.haltExternal(l.run.id, "session_key_revoked", "Session key revoked. New orders are stopped.");
    return c.json(out);
  });

  // ---------- markets ----------
  const marketView = (id: string, u: User) => {
    const m = registry.get(id)!; const t = clock.now(); const p = mkt.price(id, t); const p24 = mkt.price(id, t - 86_400_000);
    const eq = m.assetClass === "equity" || m.assetClass === "etf";
    return { id: m.id, venue: m.venue, kind: m.kind, symbol: m.symbol, assetClass: m.assetClass, name: m.name, price: p ? dec(p.value, 6) : null, change24hPct: p?.change24hPct != null ? dec(p.change24hPct, 2) : p && p24 ? dec(((p.value - p24.value) / p24.value) * 100, 2) : null,
      change24hSource: p?.change24hPct != null ? ("vendor" as const) : p && p24 ? ("computed" as const) : null,
      priceSource: toPriceSource(p?.source), priceAt: p ? iso(p.observedAt) : null, priceStale: !!p?.stale, priceStaleReason: p?.staleReason ?? null, marketSession: eq ? nyseSession(t) : ("always" as const), geoRestricted: eq && !stockOk(u), tradable: m.venue !== "polymarket" && (cfg.QUIVR_MODE === "mock" || !m.mock), ...priceFlags(toPriceSource(p?.source)), ...addressFlags(m), spark: spark(id, t) };
  };
  /** 24 hourly closes, oldest first (display only). Missing points are skipped. */
  const REAL = new Set(["chainlink_mainnet_readonly", "jupiter_readonly"]);
  const priceFlags = (src: string) => ({ isMock: src.startsWith("mock"), priceIsReal: REAL.has(src),
    priceVerifiedChainId: src === "chainlink_mainnet_readonly" ? 4663 : null,
    priceVerifiedNetwork: src === "chainlink_mainnet_readonly" ? ("robinhood-4663" as const) : src === "jupiter_readonly" ? ("solana" as const) : null });
  const addressFlags = (m: InstrumentMeta) => {
    if (m.kind !== "token") return { addressVerified: null, tokenAddress: null, addressChainId: null, addressSource: null };
    const a = o.assetInfo?.(m) ?? null;
    return { addressVerified: !!a, tokenAddress: a?.address ?? null, addressChainId: a?.chainId ?? null, addressSource: a?.source ?? null };
  };
  const spark = (id: string, t: number, n = 24, stepMs = 3_600_000) => {
    const out: number[] = []; const end = Math.floor(t / stepMs) * stepMs;
    for (let k = n - 1; k >= 0; k--) { const p = mkt.price(id, k === 0 ? t : end - k * stepMs); if (p) out.push(+p.value.toPrecision(6)); }
    return out;
  };
  r.get("/venues", (c) => c.json(venueInfo()));
  r.get("/markets", (c) => {
    const q = query(c, A.MarketsQuery); const u = c.get("user");
    const rows = registry.all().filter((m) => (!q.venue || m.venue === q.venue) && (!q.assetClass || m.assetClass === q.assetClass) && (!q.q || (m.symbol + " " + m.name).toLowerCase().includes(q.q.toLowerCase())))
      .map((m) => ({ ...marketView(m.id, u), _k: 0 })).map(({ _k, ...x }) => x);
    const start = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString()) || 0 : 0;
    const items = rows.slice(start, start + q.limit);
    return c.json({ items, nextCursor: start + q.limit < rows.length ? Buffer.from(String(start + q.limit)).toString("base64url") : null });
  });
  // ---------- M5.1: market detail (history + stats) ----------
  const TF_MS = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
  const RANGE_MS = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000, "1y": 365 * 86_400_000 } as const;
  const MAX_BARS = 500;
  const statsOf = (b: { o: number; h: number; l: number; c: number }[]) => {
    if (!b.length) return { open: null, high: null, low: null, last: null, changePct: null, rangePct: null, volatilityPct: null, bars: 0 };
    const hi = Math.max(...b.map((x) => x.h)), lo = Math.min(...b.map((x) => x.l)), o0 = b[0].o, last = b[b.length - 1].c;
    const lr = b.slice(1).map((x, i) => Math.log(x.c / b[i].c)).filter(Number.isFinite);
    const mean = lr.reduce((a, x) => a + x, 0) / (lr.length || 1); const sd = lr.length > 1 ? Math.sqrt(lr.reduce((a, x) => a + (x - mean) ** 2, 0) / (lr.length - 1)) : null;
    return { open: dec(o0, 6), high: dec(hi, 6), low: dec(lo, 6), last: dec(last, 6), changePct: dec(((last - o0) / o0) * 100, 2), rangePct: dec(((hi - lo) / lo) * 100, 2), volatilityPct: sd == null ? null : dec(sd * 100, 4), bars: b.length };
  };
  const synthNotice = () => (mkt.synthetic ? "Example data: prices are simulated, not real market history." : null);
  const ownMarket = (c: Context<Env>) => { const id = decodeURIComponent(c.req.param("instrumentId") ?? ""); if (!registry.get(id)) throw new ApiErr("not_found", "Market not found."); return id; };
  r.get("/markets/:instrumentId/history", async (c) => {
    const id = ownMarket(c); const q = query(c, MK.MarketHistoryQuery); const tf = TF_MS[q.tf], span = RANGE_MS[q.range];
    const n = Math.floor(span / tf);
    if (n > MAX_BARS) throw new ApiErr("validation_failed", `Too many bars (${n}); use a larger timeframe for this range (max ${MAX_BARS}).`, { maxBars: MAX_BARS });
    const t = clock.now();
    let bars: { o: number; h: number; l: number; c: number; t: number }[] | null = null; let dataSource: "tiingo" | "fallback" = "fallback";
    let cov: { source: string; from: number; to: number; gaps: number; synthetic: boolean; modeled?: boolean }[] | undefined;
    if (tiingo && isStock(id)) { // M5.18: Tiingo daily / IEX intraday; any failure or empty window → current source
      const tb = (await tiingo.bars(registry.get(id)!.symbol, tf, t - span, t, c.get("user").id))?.filter((x) => x.t > t - span && x.t <= t).slice(-n);
      if (tb?.length) { bars = tb; dataSource = "tiingo"; cov = [{ source: tf >= 86_400_000 ? "tiingo_daily" : "tiingo_iex", from: tb[0].t, to: tb.at(-1)!.t, gaps: 0, synthetic: false }]; }
    }
    if (!bars) { bars = mkt.bars(id, tf, t, n) ?? []; cov = (mkt as MarketData).coverage?.(id, t - span, t) ?? [{ source: mkt.synthetic ? "mock" : "live", from: t - span, to: t, gaps: 0, synthetic: mkt.synthetic }]; }
    const synth = dataSource === "tiingo" ? false : mkt.synthetic;
    return c.json({ instrumentId: id, tf: q.tf, range: q.range, from: iso(t - span), to: iso(t),
      bars: bars.map((x) => ({ t: iso(x.t), o: dec(x.o, 6), h: dec(x.h, 6), l: dec(x.l, 6), c: dec(x.c, 6) })), stats: statsOf(bars), synthetic: synth, dataSource,
      coverage: cov!.map((x) => ({ ...x, from: iso(x.from), to: iso(x.to) })), notice: warmup.warming && dataSource !== "tiingo" ? WARMUP_NOTICE : synth ? synthNotice() : null,
        warmup: warmup.warming && dataSource !== "tiingo", warmupNotice: warmup.warming && dataSource !== "tiingo" ? WARMUP_OBJ : null } satisfies MK.MarketHistoryRes);
  });
  r.get("/markets/:instrumentId/detail", (c) => {
    const id = ownMarket(c); const t = clock.now(); const now = mkt.price(id, t);
    const ret = (ms: number) => { const p = mkt.price(id, t - ms); return now && p && p.value ? dec(((now.value - p.value) / p.value) * 100, 2) : null; };
    const s30 = statsOf(mkt.bars(id, 86_400_000, t, 30) ?? []);
    return c.json({ market: marketView(id, c.get("user")), returns: { "1d": ret(86_400_000), "7d": ret(7 * 86_400_000), "30d": ret(30 * 86_400_000) },
      high30d: s30.high, low30d: s30.low, volatility30dPct: s30.volatilityPct, synthetic: mkt.synthetic, notice: synthNotice() } as MK.MarketDetailRes);
  });
  r.get("/markets/:instrumentId", (c) => { const id = decodeURIComponent(c.req.param("instrumentId")); if (!registry.get(id)) throw new ApiErr("not_found", "Market not found."); return c.json(marketView(id, c.get("user"))); });
  r.post("/quotes", async (c) => {
    const b = await body(c, A.QuoteReq); const m = registry.get(b.instrument); if (!m) throw new ApiErr("not_found", "Market not found.");
    try {
      const q = await adapters[m.venue].quote(m.id, b.side, Number(b.notionalUsd), clock.now());
      return c.json({ instrument: q.instrument, route: q.route, price: dec(q.price, 6), qty: dec(q.qty, 8), priceImpactBps: q.priceImpactBps, feeUsd: usd(q.feeUsd), gasUsd: q.gasUsd == null ? null : usd(q.gasUsd), referencePrice: q.referencePrice == null ? null : dec(q.referencePrice, 6), referenceSource: q.referenceSource, expiresAt: iso(clock.now() + 15_000) });
    } catch (e) { if (e instanceof VenueError) throw new ApiErr(e.code === "unsupported_instrument" ? "not_found" : e.code, e.message); throw e; }
  });
  // ---------- M4.6 open positions (live runs only; stopped runs are flat) ----------
  const openPositions = (uid: string, mode: string, runId?: string) => { const t = clock.now(); const items: z.infer<typeof A.OpenPosition>[] = [];
    for (const l of runs.live.values()) { if (l.run.ownerId !== uid || l.run.mode !== mode || (runId && l.run.id !== runId)) continue;
      for (const p of l.ex.acct.positions.values()) { if (p.qty === 0) continue; const m = registry.get(p.instrument)!; const mk = mkt.price(p.instrument, t)?.value ?? null;
        items.push({ instrument: p.instrument as z.infer<typeof A.OpenPosition>["instrument"], symbol: m.symbol, venue: m.venue as z.infer<typeof A.OpenPosition>["venue"], runId: l.run.id as z.infer<typeof A.OpenPosition>["runId"], strategyId: l.run.strategyId as z.infer<typeof A.OpenPosition>["strategyId"], strategyName: runStratName(l.run.id) ?? "",
          qty: dec(Math.abs(p.qty), 8), side: p.qty > 0 ? "long" : "short", avgEntry: dec(p.avgEntry, 6), markPrice: mk == null ? null : dec(mk, 6), unrealizedPnlUsd: mk == null ? null : usd(p.qty * (mk - p.avgEntry)), notionalUsd: mk == null ? null : usd(Math.abs(p.qty) * mk), openedAt: iso(p.openedAt) }); } }
    items.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt) || a.runId.localeCompare(b.runId) || a.instrument.localeCompare(b.instrument));
    return A.PositionsRes.parse({ mode, items, asOf: iso(t) }); };
  r.get("/positions", (c) => { const q = query(c, A.PositionsQuery); const uid = c.get("user").id;
    if (q.runId) { const run = store.runs.get(q.runId); if (!run || run.ownerId !== uid) throw new ApiErr("not_found", "Run not found."); }
    return c.json(openPositions(uid, q.mode, q.runId)); });
  r.get("/runs/:id/positions", (c) => { const run = store.runs.get(c.req.param("id")); const uid = c.get("user").id;
    if (!run || run.ownerId !== uid) throw new ApiErr("not_found", "Run not found."); return c.json(openPositions(uid, run.mode, run.id)); });
  r.get("/portfolio", (c) => {
    const q = query(c, A.PortfolioQuery); const uid = c.get("user").id; const t = clock.now();
    const lives = [...runs.live.values()].filter((l) => l.run.ownerId === uid && l.run.mode === q.mode);
    let eq = 0, cash = 0, real = 0, unr = 0; const positions: any[] = [];
    for (const l of lives) {
      const a = l.ex.acct; eq += l.ex.equity(t); cash += a.cash; real += a.realized;
      for (const p of a.positions.values()) { const m = registry.get(p.instrument)!; const mk = mkt.price(p.instrument, t)?.value ?? null; const u = mk == null ? null : p.qty * (mk - p.avgEntry); if (u) unr += u;
        positions.push({ instrument: p.instrument, symbol: m.symbol, venue: m.venue, qty: dec(p.qty, 8), avgEntry: dec(p.avgEntry, 6), markPrice: mk == null ? null : dec(mk, 6), valueUsd: mk == null ? null : usd(Math.abs(p.qty) * mk), unrealizedPnlUsd: u == null ? null : usd(u), runId: l.run.id }); }
    }
    return c.json({ mode: q.mode, equityUsd: usd(eq), cashUsd: usd(cash), realizedPnlUsd: usd(real), unrealizedPnlUsd: usd(unr), positions, asOf: iso(t) });
  });

  // ---------- M4.5 autopilot (paper only) ----------
  const autopilot = new AutopilotService({ now: () => clock.now(), platformKill: () => killSwitch,
    logError: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
    start: (uid, strategyId, eq, approvalMode) => { const u = store.users.get(uid); if (!u) throw new ApiErr("not_found", "User not found.");
      const sm = startRunFor(u, A.StartRunReq.parse({ strategyId, mode: "paper", approvalMode, paper: { startingEquityUsd: eq } })); store.audit.push({ at: clock.now(), userId: uid, action: "autopilot.start_run", target: sm.id }); return sm.id; },
    stop: async (id) => { await runs.control(id, "stop_and_flatten"); },
    stats: (id) => { const l = runs.get(id); const run = store.runs.get(id); if (!l || !run) return null; const t = run.stoppedAt ?? clock.now(); const eq = l.ex.equity(t);
      return { equity: eq, peak: Math.max(run.startingEquity, eq, ...l.equity.map((p) => p[1])), starting: run.startingEquity, stopped: run.status === "stopped", status: run.status }; } }, store.autopilot);
  if (persist?.loadedFrom) void autopilot.reconcile();
  if (o.autoTimers ?? true) { const t = setInterval(() => void autopilot.stepAll().catch(() => {}), AP.AUTOPILOT_STEP_SEC * 1000); t.unref?.(); }
  const apDec = (x: z.infer<typeof AP.AutopilotDecision>): z.infer<typeof AP.AutopilotDecisionView> => ({ ...x, strategyName: stratName(x.strategyId) ?? runStratName(x.toRunId ?? x.fromRunId), fromStrategyName: runStratName(x.fromRunId), toStrategyName: runStratName(x.toRunId) });
  const apView = (uid: string): z.infer<typeof AP.Autopilot> => {
    const s = autopilot.users.get(uid); const g = s?.cfg.guardrails ?? { maxDrawdownPct: 10, maxDailyLossUsd: 500, maxRotationsPerDay: 12 };
    return { configured: !!s, enabled: !!s?.cfg.enabled, killed: !!s?.killed, mode: "paper", strategyIds: s?.cfg.strategyIds ?? [], rotateEveryMin: s?.cfg.rotateEveryMin ?? 60, approvalMode: s?.cfg.approvalMode ?? "auto", startingEquityUsd: s?.cfg.startingEquityUsd ?? "10000", guardrails: g,
      state: { currentRunId: s?.currentRunId ?? null, currentStrategyId: s?.currentStrategyId ?? null, currentStrategyName: stratName(s?.currentStrategyId), nextRotationAt: s?.currentRunId ? iso(s.since + s.cfg.rotateEveryMin * 60_000) : null, rotationsToday: s?.rotations ?? 0, dayPnlUsd: usd(s ? autopilot.dayPnl(s) : 0), platformKillSwitch: killSwitch, lastDecision: s?.log.length ? apDec(s.log.at(-1)!) : null } };
  };
  r.get("/autopilot", (c) => c.json(apView(c.get("user").id)));
  r.put("/autopilot", async (c) => {
    const raw = await c.req.json().catch(() => null) as { mode?: unknown } | null;
    if (raw && raw.mode !== undefined && raw.mode !== "paper") throw new ApiErr("mode_not_enabled", "Autopilot is paper-only.");
    const b = await body(c, AP.PutAutopilotReq); const uid = c.get("user").id;
    for (const id of b.strategyIds) { const st = store.strategies.get(id); if (!st || st.ownerId !== uid || st.archived) throw new ApiErr("not_found", `Strategy ${id} not found.`); }
    const was = autopilot.users.get(uid)?.cfg.enabled;
    if ((await autopilot.put(uid, b)) === "killed") throw new ApiErr("conflict", "Autopilot was killed; send acknowledgeKill: true to re-enable.");
    if (was && !b.enabled) await autopilot.disable(uid, "disabled", "disabled by user");
    store.audit.push({ at: clock.now(), userId: uid, action: "autopilot.put", target: b.enabled ? "enabled" : "disabled" });
    if (b.enabled) await autopilot.step(uid);
    return c.json(apView(uid));
  });
  r.post("/autopilot/kill", async (c) => { const uid = c.get("user").id; if (!autopilot.users.get(uid)) throw new ApiErr("not_found", "Autopilot is not configured.");
    const k = await autopilot.disable(uid, "killed", "kill switch"); store.audit.push({ at: clock.now(), userId: uid, action: "autopilot.kill", target: uid, meta: { stopped: k.stopped, failed: k.failed.length } });
    return c.json(AP.AutopilotKillRes.parse({ ...apView(uid), kill: k }), k.failed.length ? 207 : 200); });
  // ---- M5.4 autopilot plan (paper, deterministic scoring; streamed over SSE or returned whole) ----
  const planBusy = new Set<string>();
  const buildPlan = async (uid: string, b: z.infer<typeof AP.AutopilotPlanReq>, emit: (ev: "status" | "candidate", d: unknown) => Promise<void>, canceled: () => boolean) => {
    const mine = [...store.strategies.values()].filter((x) => x.ownerId === uid);
    const ids = b.strategyIds ?? mine.slice(-10).map((x) => x.id);
    for (const id of ids) if (!mine.some((x) => x.id === id)) throw new ApiErr("not_found", `Strategy ${id} not found.`);
    if (!ids.length) throw new ApiErr("validation_failed", "You have no strategies yet. Create one first.");
    await emit("status", { stage: "loading", message: `Scoring ${ids.length} strateg${ids.length === 1 ? "y" : "ies"} on the last ${b.lookbackDays} days.` });
    const to = Math.floor(clock.now() / 3_600_000) * 3_600_000, from = to - b.lookbackDays * 86_400_000; let synthetic = false;
    const cands: z.infer<typeof AP.AutopilotPlanCandidate>[] = [];
    for (const [i, id] of ids.entries()) {
      if (canceled()) return null;
      const name = stratName(id) ?? id; const base = { strategyId: id, name, index: i, total: ids.length };
      await emit("status", { stage: "scoring", message: `Backtesting ${name} (${i + 1}/${ids.length}).` });
      let cand: z.infer<typeof AP.AutopilotPlanCandidate>;
      try {
        const v = validateStrategy(store.strategies.get(id)!.versions.at(-1)!.strategy, { registry, stockTokensAllowed: true });
        if (!v.strategy || hasErrors(v.issues)) throw new BacktestError("validation_failed", "Strategy has validation errors.");
        const out = await runBacktest({ strategy: v.strategy, from, to, resolution: "1h", startingEquity: Number(b.startingEquityUsd), feeModel: "default" }, { mkt, adapters, registry, stockTokensAllowed: true }, { canceled });
        if (!out) return null; synthetic ||= out.coverage.some((x) => x.synthetic);
        const m = out.result; const ret = Number(m.returnPct), dd = Number(m.maxDrawdownPct), sh = m.sharpe === null ? 0 : Math.max(-3, Math.min(3, Number(m.sharpe)));
        const score = b.goal === "return" ? ret - 0.25 * dd : b.goal === "low_risk" ? -dd + 0.25 * ret + sh : ret - 0.5 * dd + 2 * sh;
        cand = { ...base, ok: true, error: null, metrics: { returnPct: m.returnPct, maxDrawdownPct: m.maxDrawdownPct, sharpe: m.sharpe, trades: m.trades }, score: Number(score.toFixed(4)) };
      } catch (e) { cand = { ...base, ok: false, error: e instanceof BacktestError ? e.message : "Backtest failed.", metrics: null, score: null }; }
      cands.push(cand); await emit("candidate", cand);
    }
    await emit("status", { stage: "ranking", message: "Ranking and building the plan." });
    const ranked = cands.filter((x) => x.ok && x.metrics!.trades > 0 && Number(x.metrics!.maxDrawdownPct) <= 25).sort((x, y) => y.score! - x.score! || x.strategyId.localeCompare(y.strategyId)).slice(0, 5);
    const excluded = cands.filter((x) => !ranked.includes(x));
    const worstDd = Math.max(0, ...ranked.map((x) => Number(x.metrics!.maxDrawdownPct)));
    const guardrails = { maxDrawdownPct: Math.min(50, Math.max(5, Math.ceil(worstDd * 1.5))), maxDailyLossUsd: Math.max(50, Math.round(Number(b.startingEquityUsd) * (b.goal === "low_risk" ? 0.02 : 0.05))), maxRotationsPerDay: b.goal === "low_risk" ? 6 : 12 };
    const rotateEveryMin = b.goal === "low_risk" ? 240 : b.goal === "return" ? 60 : 120;
    const proposal = ranked.length ? AP.PutAutopilotReq.parse({ enabled: false, mode: "paper", strategyIds: ranked.map((x) => x.strategyId), rotateEveryMin, startingEquityUsd: b.startingEquityUsd, guardrails, approvalMode: "auto" }) : null;
    const rationale = ranked.length ? [`Top pick: ${ranked[0].name} (${ranked[0].metrics!.returnPct}% return, ${ranked[0].metrics!.maxDrawdownPct}% max drawdown over ${b.lookbackDays}d).`,
      `Rotates every ${rotateEveryMin} min across ${ranked.length} strateg${ranked.length === 1 ? "y" : "ies"}; stops at ${guardrails.maxDrawdownPct}% drawdown or $${guardrails.maxDailyLossUsd} daily loss.`,
      ...(excluded.length ? [`Left out ${excluded.length}: no trades, errors, or drawdown above 25%.`] : [])] : ["Nothing qualified: every strategy had no trades, an error, or drawdown above 25%."];
    return { goal: b.goal, lookbackDays: b.lookbackDays, ranked, excluded, proposal, rationale, source: "deterministic" as const, synthetic,
      notice: "Paper only. Past (and synthetic) performance does not predict results. Nothing is applied until you save the autopilot." } satisfies z.infer<typeof AP.AutopilotPlan>;
  };
  const planPrecheck = (uid: string, b: z.infer<typeof AP.AutopilotPlanReq>) => { const mine = [...store.strategies.values()].filter((x) => x.ownerId === uid);
    for (const id of b.strategyIds ?? []) if (!mine.some((x) => x.id === id)) throw new ApiErr("not_found", `Strategy ${id} not found.`);
    if (!mine.length) throw new ApiErr("validation_failed", "You have no strategies yet. Create one first."); };
  const planGate = (uid: string, b: z.infer<typeof AP.AutopilotPlanReq>) => { planPrecheck(uid, b); limit(`plan:${uid}`, 6, 60_000); if (planBusy.has(uid)) throw new ApiErr("rate_limited", "A plan is already being built. Wait for it to finish.", undefined, 5); planBusy.add(uid); };
  r.post("/autopilot/plan", async (c) => { const uid = c.get("user").id; const b = await body(c, AP.AutopilotPlanReq); planGate(uid, b);
    try { return c.json((await buildPlan(uid, b, async () => {}, () => false))!); } finally { planBusy.delete(uid); } });
  r.post("/autopilot/plan/stream", async (c) => { const uid = c.get("user").id; const b = await body(c, AP.AutopilotPlanReq); planGate(uid, b);
    return streamSSE(c, async (s) => { let gone = false; s.onAbort(() => { gone = true; });
      try { const plan = await buildPlan(uid, b, (ev, d) => s.writeSSE({ event: ev, data: JSON.stringify(d) }), () => gone); if (plan) await s.writeSSE({ event: "plan", data: JSON.stringify(plan) }); }
      catch (e) { const err = e instanceof ApiErr ? { code: e.code, message: e.message } : { code: "internal", message: "Plan failed. Try again." }; await s.writeSSE({ event: "error", data: JSON.stringify(err) }); }
      finally { planBusy.delete(uid); } }); });
  r.get("/autopilot/log", (c) => { const q = query(c, PageQuery); const s = autopilot.users.get(c.get("user").id); const rows = (s?.log ?? []).map((x, i) => ({ ...x, id: String(i), _t: i }));
    const p = paginate(rows, (x) => x._t, q.limit, q.cursor); return c.json({ items: p.items.map(({ id: _i, _t, ...x }) => apDec(x)), nextCursor: p.nextCursor }); });

  // ---------- M4.3 portfolio views ----------
  const userRuns = (uid: string, mode: string) => [...store.runs.values()].filter((r) => r.ownerId === uid && r.mode === mode).sort((a, b) => a.startedAt - b.startedAt); // stable: ties keep creation order
  r.get("/portfolio/runs", (c) => {
    const q = query(c, A.PortfolioRunsQuery); const t = clock.now(); const T = { st: 0, eq: 0, real: 0, unr: 0, fees: 0, open: 0, fills: 0 };
    const items = userRuns(c.get("user").id, q.mode).filter((r) => q.status === "all" || (q.status === "stopped") === (r.status === "stopped")).map((run) => {
      const l = runs.get(run.id); const at = run.stoppedAt ?? t; const eq = l ? l.ex.equity(at) : run.startingEquity; let unr = 0;
      if (l) for (const p of l.ex.acct.positions.values()) { const mk = mkt.price(p.instrument, at)?.value; if (mk != null) unr += p.qty * (mk - p.avgEntry); }
      const real = l?.ex.acct.realized ?? 0, fees = l?.ex.acct.fees ?? 0, open = l?.ex.acct.positions.size ?? 0, fills = run.events.filter((e) => e.type === "fill").length;
      T.st += run.startingEquity; T.eq += eq; T.real += real; T.unr += unr; T.fees += fees; T.open += open; T.fills += fills;
      return { runId: run.id, strategyId: run.strategyId, status: run.status, startedAt: iso(run.startedAt), stoppedAt: run.stoppedAt ? iso(run.stoppedAt) : null, startingEquityUsd: usd(run.startingEquity), equityUsd: usd(eq), pnlUsd: usd(eq - run.startingEquity), pnlPct: dec(((eq - run.startingEquity) / run.startingEquity) * 100, 2), realizedPnlUsd: usd(real), unrealizedPnlUsd: usd(unr), feesUsd: usd(fees), openPositions: open, fills };
    });
    return c.json({ mode: q.mode, items, totals: { startingEquityUsd: usd(T.st), equityUsd: usd(T.eq), pnlUsd: usd(T.eq - T.st), pnlPct: dec(T.st ? ((T.eq - T.st) / T.st) * 100 : 0, 2), realizedPnlUsd: usd(T.real), unrealizedPnlUsd: usd(T.unr), feesUsd: usd(T.fees), openPositions: T.open, fills: T.fills }, asOf: iso(t) } satisfies z.infer<typeof A.PortfolioRuns>);
  });
  r.get("/portfolio/allocation", (c) => {
    const q = query(c, A.PortfolioAllocationQuery); const t = clock.now(); const g = new Map<string, { label: string; long: number; short: number; n: number }>(); let cash = 0;
    for (const run of userRuns(c.get("user").id, q.mode)) { const l = runs.live.get(run.id); if (!l) continue; cash += l.ex.acct.cash;
      for (const p of l.ex.acct.positions.values()) { const m = registry.get(p.instrument)!; const v = Math.abs(p.qty) * (mkt.price(p.instrument, t)?.value ?? p.avgEntry);
        const key = q.by === "venue" ? m.venue : q.by === "asset_class" ? m.assetClass : m.id; const label = q.by === "instrument" ? `${m.symbol} (${m.venue} ${m.kind})` : key;
        const e = g.get(key) ?? { label, long: 0, short: 0, n: 0 }; if (p.qty >= 0) e.long += v; else e.short += v; e.n++; g.set(key, e); } }
    const gross = [...g.values()].reduce((a, e) => a + e.long + e.short, 0), net = [...g.values()].reduce((a, e) => a + e.long - e.short, 0);
    const items = [...g.entries()].map(([key, e]) => ({ key, label: e.label, longUsd: usd(e.long), shortUsd: usd(e.short), grossUsd: usd(e.long + e.short), netUsd: usd(e.long - e.short), weightPct: dec(gross ? ((e.long + e.short) / gross) * 100 : 0, 2), positions: e.n, _g: e.long + e.short }))
      .sort((a, b) => b._g - a._g || (a.key < b.key ? -1 : 1)).map(({ _g, ...x }) => x);
    return c.json({ mode: q.mode, by: q.by, grossExposureUsd: usd(gross), netExposureUsd: usd(net), cashUsd: usd(cash), items, asOf: iso(t) } satisfies z.infer<typeof A.PortfolioAllocation>);
  });
  r.get("/portfolio/history", (c) => {
    const q = query(c, A.PortfolioHistoryQuery); const rs = userRuns(c.get("user").id, q.mode).map((r) => ({ r, curve: runs.get(r.id)?.equity ?? [] })).filter((x) => x.curve.length);
    const ts = [...new Set(rs.flatMap((x) => x.curve.map((p) => p[0])))].sort((a, b) => a - b); const idx = rs.map(() => -1);
    const all = ts.map((t) => { let eq = 0, st = 0, n = 0; rs.forEach((x, j) => { while (idx[j]! + 1 < x.curve.length && x.curve[idx[j]! + 1]![0] <= t) idx[j]!++; if (idx[j]! >= 0) { eq += x.curve[idx[j]!]![1]; st += x.r.startingEquity; if (x.r.stoppedAt == null || x.r.stoppedAt > t) n++; } }); return { ts: iso(t), equityUsd: usd(eq), pnlUsd: usd(eq - st), activeRuns: n }; });
    const pts = all.length <= q.points ? all : Array.from({ length: q.points }, (_, j) => all[Math.round((j * (all.length - 1)) / (q.points - 1))]!);
    return c.json({ mode: q.mode, points: pts, asOf: iso(clock.now()) } satisfies z.infer<typeof A.PortfolioHistory>);
  });

  // ---------- M4.4 run replay ----------
  r.get("/runs/:id/replay", (c) => {
    const run = ownRun(c, c.req.param("id")); const q = query(c, A.ReplayQuery); const from = q.from ? Date.parse(q.from) : undefined, to = q.to ? Date.parse(q.to) : undefined;
    if (from != null && to != null && to < from) throw new ApiErr("validation_failed", "`to` must be after `from`.");
    return c.json(buildReplay(run.id, run.events, runs.get(run.id)?.equity ?? [], { frameMs: q.frameMs, maxFrames: q.maxFrames, from, to }) satisfies z.infer<typeof A.Replay>);
  });

  // ---------- v1.1: equity series ----------
  r.get("/runs/:id/equity", (c) => {
    const run = ownRun(c, c.req.param("id")); const q = query(c, X.EquitySeriesQuery);
    return c.json({ runId: run.id, backtestId: null, startingEquityUsd: usd(run.startingEquity), points: equitySeries(runs.equityCurve(run.id, q.points), run.startingEquity), synthetic: mkt.synthetic });
  });

  // ---------- v1.1: public strategies, traders, rewards, revenue, skills (mock social layer) ----------
  type Pub = { id: string; handle: string; ownerId: string | null; publishedAt: number; strategy: z.infer<typeof X.PublicStrategyDetail>["strategy"]; humanized: any; forkedFrom: string | null; row?: StrategyRow };
  const seedForks = new Map<string, number>();
  const handleOf = (u: User) => publicHandle("@" + u.label); // M5.10: never the raw label (Privy DIDs become a keyed alias)
  const publics = (): Pub[] => [
    ...SEED_PUBLIC.map((p) => ({ id: p.id, handle: p.handle, ownerId: null, publishedAt: Date.parse(p.publishedAt), strategy: p.strategy, humanized: humanize(p.strategy, registry), forkedFrom: null })),
    ...[...store.strategies.values()].filter((s) => s.public && !s.archived).map((s) => { const v = s.versions.at(-1)!; return { id: s.id, handle: handleOf(store.users.get(s.ownerId)!), ownerId: s.ownerId, publishedAt: s.publishedAt ?? s.updatedAt, strategy: v.strategy, humanized: v.humanized, forkedFrom: s.forkedFrom ?? null, row: s }; }),
  ];
  const forksOf = (p: Pub) => p.row ? p.row.forks ?? 0 : seedForks.get(p.id) ?? 0;
  const venuesOf = (st: Pub["strategy"]) => [...new Set([...st.actions.map((a) => registry.get(a.instrument)?.venue), ...st.signals.map((g) => ("instrument" in g.params ? registry.get(g.params.instrument)?.venue : undefined))].filter(Boolean))] as any[];
  const WIN_MS = { "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: 90 * 86_400_000 } as const; // "all" = last 90 days in v1
  const perfCache = new Map<string, Promise<{ ret: number; win: number | null; spark: number[]; trades: number; dd: number | null } | null>>();
  const perf = (p: Pub, w: keyof typeof WIN_MS) => {
    const to = Math.floor(clock.now() / 3_600_000) * 3_600_000; const key = `${p.id}:${w}:${to}:${p.row?.versions.length ?? 0}`;
    if (!perfCache.has(key)) perfCache.set(key, runBacktest({ strategy: p.strategy, from: to - WIN_MS[w], to, resolution: w === "7d" ? "1h" : "1h", startingEquity: 10_000, feeModel: "default" }, { mkt, adapters, registry, stockTokensAllowed: true })
      .then((o) => o ? { trades: o.result.trades, dd: o.result.maxDrawdownPct == null ? null : Number(o.result.maxDrawdownPct), ret: Number(o.result.returnPct), win: o.result.winRatePct == null ? null : Number(o.result.winRatePct), spark: thin(o.result.equitySeries.map((e) => Number(e.equityUsd)), 20) } : null).catch(() => null));
    return perfCache.get(key)!;
  };
  const thin = (xs: number[], n: number) => xs.length <= n ? xs : Array.from({ length: n }, (_, j) => xs[Math.round((j * (xs.length - 1)) / (n - 1))]);
  const summaryOf = async (p: Pub, u: User | null) => { const pf = await perf(p, "30d");
    return { id: p.id, name: p.strategy.name, author: { handle: p.handle, isYou: !!u && p.ownerId === u.id }, venues: venuesOf(p.strategy), forks: forksOf(p), paperReturn30dPct: pf ? dec(pf.ret, 2) : null, spark: pf?.spark ?? [], publishedAt: iso(p.publishedAt), mock: cfg.QUIVR_MODE === "mock" || p.ownerId === null }; };
  const findPub = (id: string) => { const p = publics().find((x) => x.id === id); if (!p) throw new ApiErr("not_found", "Public strategy not found."); return p; };

  r.get("/public/strategies", async (c) => {
    const q = query(c, X.PublicStrategiesQuery); const u = c.get("user");
    let rows = await Promise.all(publics().map((p) => summaryOf(p, u)));
    if (q.venue) rows = rows.filter((x) => x.venues.includes(q.venue));
    rows.sort((a, b) => q.sort === "forks" ? b.forks - a.forks : q.sort === "new" ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt) : Number(b.paperReturn30dPct ?? -1e9) - Number(a.paperReturn30dPct ?? -1e9));
    const start = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString()) || 0 : 0;
    return c.json({ items: rows.slice(start, start + q.limit), nextCursor: start + q.limit < rows.length ? Buffer.from(String(start + q.limit)).toString("base64url") : null });
  });
  // M5.28: guest-readable (read-only, public fields only: no ownerId, no private row data; per-IP limit). Fork stays signed-in.
  app.get("/public/strategies/:id", async (c) => {
    pubLimit(c, "pstg", 60);
    const p = findPub(c.req.param("id"));
    const h = c.req.header("authorization"); const jw = h?.startsWith("Bearer ") ? verifyJwt<{ sub: string }>(h.slice(7), secret, clock.now()) : null;
    const u = (jw && store.users.get(jw.sub)) || null;
    c.header("cache-control", u ? "private, no-store" : "public, max-age=30"); c.header("x-robots-tag", "noindex");
    return c.json({ ...(await summaryOf(p, u)), thesis: p.strategy.thesis ?? "", strategy: p.strategy, humanized: p.humanized, nodes: strategyNodes(p.strategy, registry, p.humanized), forkedFrom: p.forkedFrom });
  });
  r.post("/public/strategies/:id/fork", (c) => idem(c, async () => {
    const p = findPub(c.req.param("id")); const v = saveVersion(c, p.strategy);
    const row: StrategyRow = { id: newId("stg", clock.now()), ownerId: c.get("user").id, archived: false, versions: [{ version: 1, ...v }], createdAt: clock.now(), updatedAt: clock.now(), forkedFrom: p.id, public: false, forks: 0 };
    store.strategies.set(row.id, row);
    if (p.row) p.row.forks = (p.row.forks ?? 0) + 1; else seedForks.set(p.id, (seedForks.get(p.id) ?? 0) + 1);
    store.audit.push({ at: clock.now(), userId: row.ownerId, action: `strategy.fork:${p.id}` });
    return [strategyRecord(row), 201];
  }));
  r.post("/strategies/:id/publish", async (c) => {
    const s = ownStrategy(c, c.req.param("id")); const b = await body(c, X.PublishReq);
    if (b.public && hasErrors(s.versions.at(-1)!.issues)) throw new ApiErr("strategy_invalid", "Fix the strategy's errors before publishing.");
    s.public = b.public; if (b.public) s.publishedAt = clock.now(); s.updatedAt = clock.now(); return c.json(strategyRecord(s));
  });

  r.get("/traders", async (c) => {
    const q = query(c, X.LeaderboardQuery); const u = c.get("user");
    const by = new Map<string, { handle: string; isYou: boolean; pubs: Pub[] }>();
    for (const p of publics()) { const k = p.handle; const e = by.get(k) ?? { handle: k, isYou: p.ownerId === u.id, pubs: [] }; e.pubs.push(p); by.set(k, e); }
    if (![...by.values()].some((x) => x.isYou)) by.set(handleOf(u), { handle: handleOf(u), isYou: true, pubs: [] }); // you always appear (strategies: 0, return: null)
    const rows = await Promise.all([...by.values()].map(async (e) => {
      const ps = (await Promise.all(e.pubs.map((p) => perf(p, q.window)))).filter(Boolean) as { ret: number; win: number | null; spark: number[] }[];
      const best = ps.sort((a, b) => b.ret - a.ret)[0]; const wins = ps.map((x) => x.win).filter((x): x is number => x != null);
      return { handle: e.handle, isYou: e.isYou, venues: [...new Set(e.pubs.flatMap((p) => venuesOf(p.strategy)))], paperReturnPct: best ? dec(best.ret, 2) : null, winRatePct: wins.length ? dec(wins.reduce((a, b) => a + b, 0) / wins.length, 1) : null, strategies: e.pubs.length, spark: best?.spark ?? [] };
    }));
    rows.sort((a, b) => Number(b.paperReturnPct ?? -1e9) - Number(a.paperReturnPct ?? -1e9));
    return c.json({ window: q.window, basis: "paper", items: rows.map((x, i) => ({ rank: i + 1, ...x })), asOf: iso(clock.now()), mock: true, notice: NOTICE.leaderboard });
  });
  // ---------- M5.5 profiles, follow, paper copy-trading ----------
  const userByHandle = (h: string) => [...store.users.values()].find((x) => handleOf(x) === h) ?? null;
  const handleExists = (h: string) => publics().some((p) => p.handle === h) || !!userByHandle(h);
  const followersOf = (h: string) => [...store.users.values()].filter((x) => x.following?.includes(h)).length;
  const pubVersion = (p: Pub) => p.row ? p.row.versions.at(-1)!.version : 1;
  const profileView = async (h: string, me: User) => {
    const owner = userByHandle(h); const pubs = publics().filter((p) => p.handle === h);
    const strategies = await Promise.all(pubs.map(async (p) => { const x = await summaryOf(p, me); return { id: x.id, name: x.name, venues: x.venues, forks: x.forks, paperReturn30dPct: x.paperReturn30dPct, publishedAt: x.publishedAt }; }));
    const best = strategies.map((x) => x.paperReturn30dPct).filter((x): x is string => x !== null).sort((a, b) => Number(b) - Number(a))[0] ?? null;
    const limited = !!owner && owner.id !== me.id && pubs.length === 0; // M5.10: no public strategies -> no personal fields
    return { handle: h, displayName: limited ? null : owner?.displayName ?? null, bio: limited ? null : owner?.bio ?? null, isYou: owner?.id === me.id, isFollowing: !!me.following?.includes(h), demo: !owner, limited,
      followers: followersOf(h), following: limited ? null : owner?.following?.length ?? 0, strategies, bestPaperReturn30dPct: best } satisfies z.infer<typeof SO.Profile>;
  };
  const handleParam = (c: Context<Env>) => { const h = SO.Handle.safeParse(decodeURIComponent(c.req.param("handle")!)); if (!h.success || !handleExists(h.data)) throw new ApiErr("not_found", "Profile not found."); return h.data; };
  // M5.20: public (no-auth) profile for share pages. Per-IP rate limit; noindex; 404 for unknown handles.
  app.get("/public/profiles/:handle", (c) => {
    pubLimit(c, "pprof", 60);
    let raw: string; try { raw = decodeURIComponent(c.req.param("handle")!); } catch { throw new ApiErr("not_found", "Profile not found."); }
    const h = SO.Handle.safeParse(raw); if (!h.success || !handleExists(h.data)) throw new ApiErr("not_found", "Profile not found.");
    const owner = userByHandle(h.data); const n = publics().filter((p) => p.handle === h.data).length; const limited = !!owner && n === 0;
    c.header("cache-control", "public, max-age=30"); c.header("x-robots-tag", "noindex");
    return c.json(PB.PublicProfile.parse({ handle: h.data, exists: true, limited, displayName: limited ? null : owner?.displayName ?? null, bio: limited ? null : owner?.bio ?? null, publicStrategies: n, followers: followersOf(h.data), demo: !owner }));
  });
  r.get("/me/profile", async (c) => c.json(await profileView(handleOf(c.get("user")), c.get("user"))));
  r.put("/me/profile", async (c) => { const u = c.get("user"); const b = await body(c, SO.PutProfileReq);
    if (b.displayName !== undefined) u.displayName = b.displayName || null; if (b.bio !== undefined) u.bio = b.bio || null;
    store.audit.push({ at: clock.now(), userId: u.id, action: "profile.update" }); return c.json(await profileView(handleOf(u), u)); });
  r.get("/profiles/:handle", async (c) => c.json(await profileView(handleParam(c), c.get("user"))));
  r.post("/profiles/:handle/follow", (c) => { const u = c.get("user"); const h = handleParam(c); limit(`follow:${u.id}`, 60, 60_000);
    if (h === handleOf(u)) throw new ApiErr("validation_failed", "You can't follow yourself.");
    const f = (u.following ??= []); if (!f.includes(h)) { if (f.length >= SO.MAX_FOLLOWING) throw new ApiErr("limit_exceeded", `You can follow up to ${SO.MAX_FOLLOWING} traders.`, { limit: SO.MAX_FOLLOWING, kind: "following" }); f.push(h); }
    return c.json({ handle: h, following: true, followers: followersOf(h) } satisfies z.infer<typeof SO.FollowRes>); });
  r.delete("/profiles/:handle/follow", async (c) => { const u = c.get("user"); const h = handleParam(c); u.following = (u.following ?? []).filter((x) => x !== h);
    // M5.10: unfollow ends copying. Each copy is detached (sync blocked for good) and its paper run is stopped, with an event in the run log.
    for (const s of store.strategies.values()) { if (s.ownerId !== u.id || !s.copyOf || s.copyOf.handle !== h || s.copyOf.detachedAt) continue;
      s.copyOf.detachedAt = clock.now();
      for (const l of [...runs.live.values()].filter((l) => l.run.strategyId === s.id && l.run.status !== "stopped")) {
        runs.warn(l.run.id, "copy_unfollowed", `You unfollowed ${h}; this copy stopped and won't sync again.`); await runs.control(l.run.id, "stop_and_flatten"); }
      store.audit.push({ at: clock.now(), userId: u.id, action: "copy.detach", target: s.id }); }
    return c.json({ handle: h, following: false, followers: followersOf(h) } satisfies z.infer<typeof SO.FollowRes>); });
  r.get("/me/following", (c) => c.json({ items: (c.get("user").following ?? []).map((h) => ({ handle: h, displayName: publics().some((p) => p.handle === h) ? userByHandle(h)?.displayName ?? null : null, strategies: publics().filter((p) => p.handle === h).length })) } satisfies z.infer<typeof SO.FollowingRes>));

  // ---------- M5.12 activity feed ----------
  // M5.17 global search. Only public data: registry markets, public strategies, and traders with public strategies (M5.10).
  r.get("/search", (c) => {
    const u = c.get("user"); limit(`srch:${u.id}`, 60, 60_000); const q = query(c, SO.SearchQuery); const t = q.q.toLowerCase();
    const rank = (s: string) => { const x = s.toLowerCase(); return x === t ? 0 : x.startsWith(t) ? 1 : x.includes(t) ? 2 : -1; };
    const best = <T,>(xs: T[], keys: (x: T) => string[]) => xs.map((x) => ({ x, r: Math.min(...keys(x).map(rank).map((v) => v < 0 ? 9 : v)) })).filter((e) => e.r < 9).sort((a, b) => a.r - b.r).slice(0, q.limit).map((e) => e.x);
    const markets = best(registry.all(), (m) => [m.symbol, m.name]).map((m) => ({ id: m.id, symbol: m.symbol, name: m.name, venue: m.venue, assetClass: m.assetClass }));
    const pubs = publics();
    const strategies = best(pubs, (p) => [p.strategy.name]).map((p) => ({ publicStrategyId: p.id, name: p.strategy.name, handle: p.handle }));
    const counts = new Map<string, number>(); for (const p of pubs) counts.set(p.handle, (counts.get(p.handle) ?? 0) + 1);
    const traders = t.length < 2 ? [] : best([...counts.keys()], (h) => [h, h.slice(1)]).map((h) => ({ handle: h, strategies: counts.get(h)!, isYou: h === handleOf(u) }));
    return c.json(SO.SearchRes.parse({ markets, strategies, traders }));
  });
  r.get("/activity", (c) => {
    const u = c.get("user"); const q = query(c, SO.ActivityQuery); limit(`act:${u.id}`, 120, 60_000);
    type It = z.infer<typeof SO.ActivityItem> & { t: number };
    const out: It[] = []; const me = handleOf(u); const follows = new Set(u.following ?? []);
    const pubIds = new Set(publics().map((p) => p.id));
    const pubItems = (p: Pub, actor: { handle: string; isYou: boolean }) => {
      const vs = p.row ? p.row.versions : [];
      const pubV = p.row ? (vs.filter((v) => v.createdAt <= p.publishedAt).at(-1)?.version ?? vs[0]?.version ?? 1) : 1;
      out.push({ id: `pub.${p.id}.${pubV}`, kind: "strategy_published", t: p.publishedAt, at: iso(p.publishedAt), actor, strategy: { publicStrategyId: p.id, name: p.strategy.name, version: pubV }, run: null });
      for (const v of vs) if (v.createdAt > p.publishedAt && v.version > pubV) out.push({ id: `upd.${p.id}.${v.version}`, kind: "strategy_updated", t: v.createdAt, at: iso(v.createdAt), actor, strategy: { publicStrategyId: p.id, name: v.strategy.name, version: v.version }, run: null });
    };
    if (q.handle) { // M5.16: public view of one trader. Only public strategies and their paper runs; no run ids, copies or private strategies.
      const h = q.handle; if (!handleExists(h)) throw new ApiErr("not_found", "Trader not found.");
      const owner = userByHandle(h); const pubs = publics().filter((p) => p.handle === h); const actor = { handle: h, isYou: owner?.id === u.id };
      const limited = !!owner && owner.id !== u.id && pubs.length === 0; // M5.10 rule
      if (!limited) for (const p of pubs) { pubItems(p, actor);
        if (!owner || !p.row || p.ownerId !== owner.id) continue;
        const rs = [...store.runs.values()].filter((x) => x.strategyId === p.id && x.ownerId === owner.id && x.mode === "paper" && x.startedAt >= p.publishedAt).sort((a, b) => a.startedAt - b.startedAt);
        rs.forEach((run, n) => { const strategy = { publicStrategyId: p.id, name: p.row!.versions.find((v) => v.version === run.strategyVersion)?.strategy.name ?? p.strategy.name, version: run.strategyVersion };
          out.push({ id: `prs.${p.id}.${n + 1}`, kind: "run_started", t: run.startedAt, at: iso(run.startedAt), actor, strategy, run: null });
          if (run.stoppedAt != null) out.push({ id: `prx.${p.id}.${n + 1}`, kind: "run_stopped", t: run.stoppedAt, at: iso(run.stoppedAt), actor, strategy, run: null }); });
      }
      const pg = paginate(out, (x) => x.t, q.limit, q.cursor);
      return c.json(SO.ActivityRes.parse({ items: pg.items.map(({ t: _t, ...x }) => x), nextCursor: pg.nextCursor, limited }));
    }
    if (q.scope !== "mine") for (const p of publics()) { if (!follows.has(p.handle) || p.ownerId === u.id) continue;
      const actor = { handle: p.handle, isYou: false };
      const vs = p.row ? p.row.versions : [];
      const pubV = p.row ? (vs.filter((v) => v.createdAt <= p.publishedAt).at(-1)?.version ?? vs[0]?.version ?? 1) : 1;
      out.push({ id: `pub.${p.id}.${pubV}`, kind: "strategy_published", t: p.publishedAt, at: iso(p.publishedAt), actor, strategy: { publicStrategyId: p.id, name: p.strategy.name, version: pubV }, run: null });
      for (const v of vs) if (v.createdAt > p.publishedAt && v.version > pubV) out.push({ id: `upd.${p.id}.${v.version}`, kind: "strategy_updated", t: v.createdAt, at: iso(v.createdAt), actor, strategy: { publicStrategyId: p.id, name: v.strategy.name, version: v.version }, run: null });
    }
    if (q.scope !== "following") {
      const actor = { handle: me, isYou: true };
      for (const run of store.runs.values()) { if (run.ownerId !== u.id) continue; const st = store.strategies.get(run.strategyId);
        const strategy = { publicStrategyId: st && pubIds.has(st.id) ? st.id : null, name: st?.versions.find((v) => v.version === run.strategyVersion)?.strategy.name ?? st?.versions.at(-1)?.strategy.name ?? "Strategy", version: run.strategyVersion };
        const rv = { runId: run.id, mode: run.mode, status: run.status };
        out.push({ id: `rs.${run.id}`, kind: "run_started", t: run.startedAt, at: iso(run.startedAt), actor, strategy, run: rv });
        if (run.stoppedAt != null) out.push({ id: `rx.${run.id}`, kind: "run_stopped", t: run.stoppedAt, at: iso(run.stoppedAt), actor, strategy, run: rv }); }
      for (const s of store.strategies.values()) { if (s.ownerId !== u.id || !s.copyOf) continue; const cp = s.copyOf;
        const strategy = { publicStrategyId: pubIds.has(cp.publicStrategyId) ? cp.publicStrategyId : null, name: s.versions[0].strategy.name, version: cp.sourceVersion };
        out.push({ id: `cs.${s.id}`, kind: "copy_started", t: cp.copiedAt, at: iso(cp.copiedAt), actor: { handle: me, isYou: true }, strategy, run: null });
        if (cp.detachedAt) out.push({ id: `cd.${s.id}`, kind: "copy_detached", t: cp.detachedAt, at: iso(cp.detachedAt), actor: { handle: me, isYou: true }, strategy, run: null }); }
    }
    // Item ids embed only public strategy ids or the viewer's own run/copy ids; never another user's private ids.
    const p = paginate(out, (x) => x.t, q.limit, q.cursor);
    return c.json(SO.ActivityRes.parse({ items: p.items.map(({ t: _t, ...x }) => x), nextCursor: p.nextCursor }));
  });
  const copyView = (s: StrategyRow) => { const cp = s.copyOf!; const src = publics().find((p) => p.id === cp.publicStrategyId); const latest = src ? pubVersion(src) : null;
    const run = [...store.runs.values()].filter((x) => x.strategyId === s.id).sort((a, b) => b.startedAt - a.startedAt)[0];
    return { strategyId: s.id, publicStrategyId: cp.publicStrategyId, sourceHandle: cp.handle, sourceName: src?.strategy.name ?? s.versions.at(-1)!.strategy.name, sourceVersion: cp.sourceVersion, latestSourceVersion: latest,
      behind: latest !== null && latest > cp.sourceVersion, detached: !!cp.detachedAt, detachedAt: cp.detachedAt ? iso(cp.detachedAt) : null, mode: "paper" as const, runId: run?.id ?? null, runStatus: run?.status ?? null, copiedAt: iso(cp.copiedAt), syncedAt: iso(cp.syncedAt) } as z.infer<typeof SO.CopyView>; };
  const ownCopy = (c: Context<Env>) => { const s = store.strategies.get(c.req.param("id")!); if (!s || s.ownerId !== c.get("user").id || !s.copyOf) throw new ApiErr("not_found", "Copy not found."); return s; };
  /** M5.10: owners up the copy/fork chain (bounded), so a re-published copy of your own strategy can't be copied back. */
  const lineageOwners = (p: Pub) => { const out = new Set<string>(); let id: string | null | undefined = p.row ? (p.row.copyOf?.publicStrategyId ?? p.row.forkedFrom) : null;
    for (let i = 0; id && i < 32; i++) { const r0 = store.strategies.get(id); if (!r0) break; out.add(r0.ownerId); id = r0.copyOf?.publicStrategyId ?? r0.forkedFrom ?? null; } return out; };
  const COPY_NOTICE = "Copy-trading is paper only: it mirrors a public strategy's rules in your own paper run. No real funds, no live orders.";
  // M5.18: external-wallet copy is "coming soon" — explicit 501 not_available, nothing is tracked or stored.
  const extWalletSoon = () => { throw new ApiErr("not_available", "Copying an external wallet is coming soon. You can copy Quiver traders' public strategies today.", { feature: "external_wallet_copy" }); };
  r.get("/copy/wallet", extWalletSoon); r.post("/copy/wallet", extWalletSoon); for (const p of ["/copy/wallet/:a", "/copy/wallet/:a/:b"]) { r.get(p, extWalletSoon); r.post(p, extWalletSoon); }
  r.post("/copy", (c) => idem(c, async () => {
    const u = c.get("user"); const raw = await c.req.json().catch(() => ({}));
    if (raw && typeof raw === "object" && ["address", "wallet", "walletAddress", "externalWallet"].some((k) => k in raw)) extWalletSoon();
    if (raw && typeof raw === "object" && "mode" in raw && raw.mode !== "paper") throw new ApiErr("mode_not_enabled", "Copy-trading is paper-only.");
    const b = SO.CopyReq.safeParse(raw); if (!b.success) throw new ApiErr("validation_failed", "Invalid request.", b.error.issues);
    const p = findPub(b.data.publicStrategyId);
    if (p.ownerId === u.id || lineageOwners(p).has(u.id)) throw new ApiErr("validation_failed", "That's your own strategy (or a copy of it); run yours directly.");
    if (!u.following?.includes(p.handle)) throw new ApiErr("forbidden", `Follow ${p.handle} first to copy their strategies.`, { handle: p.handle });
    if ([...store.strategies.values()].some((x) => x.ownerId === u.id && !x.archived && x.copyOf?.publicStrategyId === p.id)) throw new ApiErr("conflict", "You already copy this strategy. Sync it instead.");
    const v = saveVersion(c, p.strategy); const t = clock.now();
    const row: StrategyRow = { id: newId("stg", t), ownerId: u.id, archived: false, versions: [{ version: 1, ...v }], createdAt: t, updatedAt: t, forkedFrom: p.id, public: false, forks: 0,
      copyOf: { publicStrategyId: p.id, handle: p.handle, sourceVersion: pubVersion(p), copiedAt: t, syncedAt: t } };
    store.strategies.set(row.id, row);
    try { startRunFor(u, A.StartRunReq.parse({ strategyId: row.id, mode: "paper", approvalMode: b.data.approvalMode, paper: { startingEquityUsd: b.data.startingEquityUsd } })); }
    catch (e) { store.strategies.delete(row.id); throw e; }
    store.audit.push({ at: t, userId: u.id, action: "copy.start", target: `${p.id}->${row.id}` });
    return [copyView(row), 201];
  }));
  r.get("/copy", (c) => { const uid = c.get("user").id;
    return c.json({ items: [...store.strategies.values()].filter((s) => s.ownerId === uid && s.copyOf && !s.archived).sort((a, b) => b.createdAt - a.createdAt).map(copyView), notice: COPY_NOTICE } satisfies z.infer<typeof SO.CopyListRes>); });
  r.post("/copy/:id/sync", (c) => { const s = ownCopy(c); const cp = s.copyOf!;
    if (cp.detachedAt || !c.get("user").following?.includes(cp.handle)) { store.audit.push({ at: clock.now(), userId: c.get("user").id, action: "copy.sync_blocked", target: s.id });
      throw new ApiErr("forbidden", cp.detachedAt ? "This copy ended when you unfollowed the trader. Copy again to start a new one." : `Follow ${cp.handle} again to sync.`, { reason: cp.detachedAt ? "detached" : "not_following" }); }
    const src = publics().find((p) => p.id === cp.publicStrategyId);
    if (!src) throw new ApiErr("conflict", "The source strategy is no longer public; your copy keeps its current rules.");
    const latest = pubVersion(src); if (latest <= cp.sourceVersion) return c.json(copyView(s));
    const v = saveVersion(c, src.strategy); const ver = s.versions.at(-1)!.version + 1; s.versions.push({ version: ver, ...v }); const t = clock.now(); s.updatedAt = t;
    cp.sourceVersion = latest; cp.syncedAt = t;
    const live = [...runs.live.values()].find((l) => l.run.strategyId === s.id && l.run.status !== "stopped");
    if (live && !hasErrors(v.issues)) runs.swapStrategy(live.run.id, v.strategy, ver, `Copied strategy synced to ${src.handle}'s v${latest}.`);
    store.audit.push({ at: t, userId: c.get("user").id, action: "copy.sync", target: `${s.id}:v${latest}` });
    return c.json(copyView(s)); });
  r.get("/rewards", (c) => {
    const uid = c.get("user").id; const mine = [...store.strategies.values()].filter((s) => s.ownerId === uid);
    const done: Record<string, boolean> = {
      draft: mine.length > 0,
      paper24h: [...store.runs.values()].some((x) => x.ownerId === uid && x.mode === "paper" && (x.stoppedAt ?? clock.now()) - x.startedAt >= 86_400_000),
      publish: mine.some((s) => s.public), forked: mine.some((s) => (s.forks ?? 0) > 0),
    };
    // EXAMPLE data: points are derived from the user's real quest progress with example weights; rank/participants are illustrative.
    const quests = QUESTS.map((q) => ({ id: q.id, title: q.title, done: !!done[q.id], points: QUEST_POINTS[q.id] ?? 100, progress: done[q.id] ? 1 : 0 }));
    const history = quests.filter((q) => q.done).map((q) => ({ at: iso(clock.now()), points: q.points, reason: `Quest: ${q.title}` }));
    const points = 50 + history.reduce((a, b) => a + b.points, 0); history.unshift({ at: EXAMPLE_SEASON.startsAt, points: 50, reason: "Welcome bonus (example)" });
    const totalParticipants = 1240; const rank = Math.max(1, Math.round(totalParticipants * (1 - points / 1300)));
    return c.json({ mock: true, example: true, notice: NOTICE.rewards, points, season: EXAMPLE_SEASON, rank, totalParticipants, quests, history });
  });
  r.get("/revenue", (c) => {
    const uid = c.get("user").id; const mine = [...store.strategies.values()].filter((s) => s.ownerId === uid && s.public);
    const bps = cfg.REVENUE_ACCOUNTING_ENABLED ? cfg.CREATOR_SHARE_BPS : undefined; const on = bps !== undefined;
    // M5.22 paper ledger: fills from OTHER users' paper runs of strategies copied/forked from mine. Integer cents to avoid float drift.
    const accrue = (sid: string) => { let vol = 0, fee = 0; if (!on) return { vol, fee };
      const kids = new Set([...store.strategies.values()].filter((k) => k.ownerId !== uid && (k.copyOf?.publicStrategyId === sid || k.forkedFrom === sid)).map((k) => k.id));
      for (const run of store.runs.values()) if (run.mode === "paper" && kids.has(run.strategyId)) for (const e of run.events) if (e.type === "fill") { vol += Math.round(Number(e.notionalUsd) * 100); fee += Math.round(Number(e.feeUsd) * 100); }
      return { vol, fee: Math.floor((fee * bps!) / 10_000) }; };
    const cents = (n: number) => (n / 100).toFixed(2);
    const rows = mine.map((s) => { const a = accrue(s.id); return { strategyId: s.id, name: s.versions.at(-1)!.strategy.name, forks: s.forks ?? 0, followersVolumeUsd: cents(a.vol), earnedUsd: cents(a.fee), _e: a.fee }; });
    const earned = rows.reduce((a, b) => a + b._e, 0);
    return c.json({ mock: true, notice: on ? "Paper ledger: what you would have earned from other people's paper runs of your strategies. Nothing is paid or claimable." : NOTICE.revenue,
      earnedUsd: cents(earned), claimableUsd: "0.00", forks: rows.reduce((a, b) => a + b.forks, 0), creatorSharePct: on ? (bps! / 100).toFixed(2) : null,
      rows: rows.map(({ _e, ...r }) => r), claimEnabled: false, accounting: on ? "paper_ledger" : "off" } satisfies z.input<typeof X.RevenueRes>);
  });
  r.get("/skills", (c) => c.json({ items: SKILLS.map((s) => ({ ...s, venues: [...s.venues] })) }));

  // ---------- v1.2 (M3.8): settings, stop-all, result card (auth) ----------
  r.get("/settings", (c) => {
    const u = c.get("user");
    const activeRuns = [...runs.live.values()].filter((l) => l.run.ownerId === u.id && l.run.status !== "stopped").length;
    const strategies = [...store.strategies.values()].filter((x) => x.ownerId === u.id && !x.archived).length;
    return c.json(X.AccountSettingsRes.parse({
      limits: { maxActiveRuns: cfg.MAX_ACTIVE_RUNS_PER_USER, maxEventStreams: cfg.MAX_SSE_PER_USER, compilesPerDay: cfg.LLM_USER_DAILY_COMPILES, maxStrategySignals: 24 },
      usage: { activeRuns, strategies, compilesUsedToday: u.compiles.day === today() ? u.compiles.n : 0 },
      sessionKeyDefaults: sk.defaults(),
      trading: { enabledModes: ["paper"], liveEnabled: false, killSwitch },
      alerts: { configured: false, channels: [], note: "Alerts are not available yet: a delivery provider (email / Telegram / webhook) has not been chosen." },
      asOf: iso(clock.now()),
    }));
  });
  r.post("/runs/stop-all", async (c) => {
    const u = c.get("user"); const b = await body(c, X.StopAllReq);
    const mine = [...store.runs.values()].filter((x) => x.ownerId === u.id && x.mode !== "live" && (!b.mode || x.mode === b.mode));
    const stopped: string[] = []; let already = 0;
    for (const run of mine) {
      if (run.status === "stopped") { already++; continue; }
      if (runs.live.has(run.id)) await runs.control(run.id, b.flatten ? "stop_and_flatten" : "stop"); else { run.status = "stopped"; run.stoppedAt = clock.now(); }
      stopped.push(run.id); store.audit.push({ at: clock.now(), userId: u.id, action: b.flatten ? "run.stop_and_flatten" : "run.stop", target: run.id });
    }
    store.audit.push({ at: clock.now(), userId: u.id, action: "run.stop_all", target: String(stopped.length) });
    return c.json(X.StopAllRes.parse({ stopped, alreadyStopped: already }));
  });
  r.get("/runs/:id/card", (c) => {
    const run = ownRun(c, c.req.param("id")); const sm = runs.summary(run);
    const st = store.strategies.get(run.strategyId); const ver = st?.versions.find((v) => v.version === run.strategyVersion) ?? st?.versions.at(-1);
    const pts = equitySeries(runs.equityCurve(run.id, 200), run.startingEquity);
    const fills = run.events.filter((e) => e.type === "fill") as Extract<(typeof run.events)[number], { type: "fill" }>[];
    const end = run.stoppedAt ?? clock.now();
    return c.json(X.RunCard.parse({
      runId: run.id, strategyId: run.strategyId, name: ver?.strategy.name ?? "Strategy", mode: run.mode, status: run.status,
      venues: ver ? venuesOf(ver.strategy) : [], startedAt: sm.startedAt, stoppedAt: sm.stoppedAt, durationSec: Math.max(0, Math.floor((end - run.startedAt) / 1000)),
      startingEquityUsd: usd(run.startingEquity), equityUsd: sm.equityUsd, pnlUsd: sm.pnlUsd, pnlPct: sm.pnlPct,
      maxDrawdownPct: dec(pts.reduce((m, p) => Math.max(m, Number(p.drawdownPct)), 0), 2),
      fills: fills.length, triggerFires: run.events.filter((e) => e.type === "trigger_fired").length, feesUsd: usd(fills.reduce((a, f) => a + Number(f.feeUsd), 0)),
      spark: thin(pts.map((p) => Number(p.equityUsd)), 30), synthetic: mkt.synthetic,
      disclaimer: run.mode === "paper" ? `Paper trading${mkt.synthetic ? " on synthetic prices" : ""}. Not real money; past results are not a promise of future returns.` : "Testnet. Not real money; past results are not a promise of future returns.",
    }));
  });

  // ---------- M4.8 public leaderboard + share cards (no auth) ----------
  /** (moved up in M5.10) Public handle: "@label" unless the label could identify a person by contact (email-ish / phone-ish / odd chars). */
  const pctSpark = (xs: number[], start: number) => xs.map((v) => Number(((v / start) * 100).toFixed(2)));
  const LB_MIN_TRADES = cfg.LEADERBOARD_MIN_TRADES; const LB_TTL_MS = 60_000;
  const lbCache = new Map<string, { at: number; v: Promise<z.infer<typeof PB.PublicLeaderboardRes>> }>();
  const lbBuild = async (period: keyof typeof WIN_MS): Promise<z.infer<typeof PB.PublicLeaderboardRes>> => {
    const now = clock.now(); const since = now - WIN_MS[period];
    const rows = await Promise.all(publics().map(async (p) => {
      const base = { handle: publicHandle(p.handle), strategyName: p.strategy.name, publicStrategyId: p.id as z.infer<typeof StrategyIdT>, venues: venuesOf(p.strategy) };
      // paper basis: the owner's most recent paper run of this strategy that started in the period with enough fills
      const paper = p.row ? [...store.runs.values()].filter((x) => x.ownerId === p.ownerId && x.strategyId === p.id && x.mode === "paper" && (period === "all" || x.startedAt >= since))
        .map((x) => ({ x, fills: x.events.filter((e) => e.type === "fill").length })).filter((y) => y.fills >= LB_MIN_TRADES).sort((a, b) => b.x.startedAt - a.x.startedAt)[0] : undefined;
      if (paper) { const sm = runs.summary(paper.x); const pts = equitySeries(runs.equityCurve(paper.x.id, 200), paper.x.startingEquity);
        return { ...base, basis: "paper" as const, returnPct: sm.pnlPct, maxDrawdownPct: dec(pts.reduce((m, q) => Math.max(m, Number(q.drawdownPct)), 0), 2), winRatePct: null, trades: paper.fills, spark: pctSpark(thin(pts.map((q) => Number(q.equityUsd)), 20), paper.x.startingEquity) }; }
      const pf = await perf(p, period); if (!pf || pf.trades < LB_MIN_TRADES) return null;
      return { ...base, basis: "backtest" as const, returnPct: dec(pf.ret, 2), maxDrawdownPct: pf.dd == null ? null : dec(pf.dd, 2), winRatePct: pf.win == null ? null : dec(pf.win, 1), trades: pf.trades, spark: pctSpark(pf.spark, 10_000) };
    }));
    const items = rows.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => Number(b.returnPct) - Number(a.returnPct) || b.trades - a.trades || a.strategyName.localeCompare(b.strategyName)).map((x, i) => ({ rank: i + 1, ...x }));
    return PB.PublicLeaderboardRes.parse({ period, minTrades: LB_MIN_TRADES, items, asOf: iso(now), synthetic: mkt.synthetic, notice: `Paper and backtest results only${mkt.synthetic ? " on synthetic prices" : ""}. Not real money; past results are not a promise of future returns.` });
  };
  app.get("/public/leaderboard", async (c) => {
    pubLimit(c, "lb", 30);
    const q = query(c, PB.PublicLeaderboardQuery); const hit = lbCache.get(q.period);
    if (!hit || clock.now() - hit.at >= LB_TTL_MS) { const v = lbBuild(q.period); lbCache.set(q.period, { at: clock.now(), v }); v.catch(() => lbCache.delete(q.period)); }
    const res = await lbCache.get(q.period)!.v; c.header("cache-control", "public, max-age=60");
    return c.json({ ...res, items: res.items.slice(0, q.limit) });
  });
  r.post("/runs/:id/card/share", (c) => {
    const run = ownRun(c, c.req.param("id"));
    if (run.mode !== "paper" && run.mode !== "testnet") throw new ApiErr("validation_failed", "Only paper and testnet runs can be shared.");
    let row = [...store.cardShares.values()].find((x) => x.runId === run.id && !x.revokedAt);
    if (!row) { row = { token: "crd_" + randomToken(24), runId: run.id, ownerId: run.ownerId, createdAt: clock.now(), revokedAt: null }; store.cardShares.set(row.token, row);
      store.audit.push({ at: clock.now(), userId: run.ownerId, action: "run.card.share", target: run.id }); }
    return c.json(PB.CardShareRes.parse({ token: row.token, path: `/v1/public/cards/${row.token}`, createdAt: iso(row.createdAt) }), 201);
  });
  r.delete("/runs/:id/card/share", (c) => {
    const run = ownRun(c, c.req.param("id")); let n = 0;
    for (const x of store.cardShares.values()) if (x.runId === run.id && !x.revokedAt) { x.revokedAt = clock.now(); n++; }
    if (n) store.audit.push({ at: clock.now(), userId: run.ownerId, action: "run.card.revoke", target: run.id });
    return c.json(PB.CardRevokeRes.parse({ revoked: n }));
  });
  // ---------- M5.7 shareable replays (frozen snapshot + render job; renderer is a stub) ----------
  const renderer = o.renderer ?? (cfg.REPLAY_RENDERER === "ffmpeg" ? ffmpegRenderer({ bin: cfg.FFMPEG_PATH, dir: cfg.REPLAY_RENDER_DIR, maxSec: cfg.REPLAY_RENDER_MAX_SEC, maxBytes: cfg.REPLAY_RENDER_MAX_BYTES }) : stubRenderer);
  let rendering = false;
  /** M5.10: plain text only: NFC, no control/format chars (bidi overrides, zero-width), no <>, collapsed spaces, max 80. */
  const cleanTitle = (t?: string) => { if (!t) return null; const x = t.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim(); return x ? [...x].slice(0, 80).join("") : null; };
  const rsView = (x: import("../store").ReplayShareRow): z.infer<typeof RS.ReplayShareView> => ({ token: x.token, path: `/v1/public/replays/${x.token}`, runId: x.runId, title: x.title, createdAt: iso(x.createdAt), revokedAt: x.revokedAt ? iso(x.revokedAt) : null, frames: x.replay.totalFrames, digest: x.replay.digest, render: rjView(x.render) });
  const rjView = (j: import("../store").ReplayShareRow["render"]) => ({ ...j, requestedAt: j.requestedAt ? iso(j.requestedAt) : null, finishedAt: j.finishedAt ? iso(j.finishedAt) : null });
  const queueRender = (x: import("../store").ReplayShareRow, spec: z.infer<typeof RS.RenderSpec>) => {
    x.render = { status: "queued", jobId: newId("rjb", clock.now()), renderer: renderer.name, spec: { ...spec, ...dims(spec.aspect), totalFrames: spec.fps * spec.durationSec }, requestedAt: clock.now(), finishedAt: null, videoUrl: null, posterUrl: null, error: null };
  };
  const processRenders = async () => {
    if (rendering) return; rendering = true; try {
    for (const x of store.replayShares.values()) {
      if (x.render.status !== "queued" || x.revokedAt || !x.render.spec) continue;
      const job = x.render.jobId; x.render.status = "rendering";
      let out; try { out = await renderer.render({ token: x.token, ...x.render.spec, equity: (x.replay.frames as { equityUsd: string | null }[]).map((f) => f.equityUsd == null ? null : Number(f.equityUsd)) }); } catch (e) { out = { ok: false as const, error: String((e as Error).message).slice(0, 200) }; }
      if (x.render.jobId !== job) continue; // superseded
      x.render.finishedAt = clock.now();
      if (out.ok) Object.assign(x.render, { status: "done", videoUrl: out.videoUrl, posterUrl: out.posterUrl, error: null }); else Object.assign(x.render, { status: out.notConfigured ? "not_configured" : "failed", error: out.error });
    }
    } finally { rendering = false; }
  };
  if (o.autoTimers ?? true) { const t = setInterval(() => void processRenders(), 5000); t.unref?.(); }
  r.post("/runs/:id/replay/share", async (c) => {
    const u = c.get("user"); limit(`rps:${u.id}`, 10, 60_000);
    const run = ownRun(c, c.req.param("id")); const b = await body(c, RS.CreateReplayShareReq);
    if (run.mode !== "paper" && run.mode !== "testnet") throw new ApiErr("validation_failed", "Only paper and testnet runs can be shared.");
    if ([...store.replayShares.values()].filter((x) => x.ownerId === u.id && !x.revokedAt).length >= RS.MAX_REPLAY_SHARES) throw new ApiErr("limit_exceeded", `Up to ${RS.MAX_REPLAY_SHARES} shared replays. Revoke one first.`, undefined, DEFAULT_RETRY_AFTER_SEC);
    const rep = buildReplay(run.id, run.events, runs.get(run.id)?.equity ?? [], { frameMs: b.frameMs, maxFrames: b.maxFrames, from: b.from ? Date.parse(b.from) : undefined, to: b.to ? Date.parse(b.to) : undefined });
    if (!rep.frames.length) throw new ApiErr("validation_failed", "Nothing to replay in that range yet.");
    const st = store.strategies.get(run.strategyId);
    const x: import("../store").ReplayShareRow = { token: "rpl_" + randomToken(24), runId: run.id, ownerId: u.id, title: cleanTitle(b.title) ?? cleanTitle(`${st?.versions.at(-1)?.strategy.name ?? "Strategy"} replay`) ?? "Replay", createdAt: clock.now(), revokedAt: null, replay: rep as never,
      render: { status: "none", jobId: null, renderer: renderer.name, spec: null, requestedAt: null, finishedAt: null, videoUrl: null, posterUrl: null, error: null } };
    if (b.render) queueRender(x, b.render);
    store.replayShares.set(x.token, x); store.audit.push({ at: clock.now(), userId: u.id, action: "replay.share", target: run.id });
    return c.json(RS.ReplayShareView.parse(rsView(x)), 201);
  });
  r.get("/me/replays", (c) => { const uid = c.get("user").id; return c.json(RS.ReplayShareList.parse({ items: [...store.replayShares.values()].filter((x) => x.ownerId === uid).sort((a, b) => b.createdAt - a.createdAt).map(rsView) })); });
  const ownShare = (c: any) => { const x = store.replayShares.get(c.req.param("token")); if (!x || x.ownerId !== c.get("user").id) throw new ApiErr("not_found", "Replay not found."); return x; };
  r.post("/replays/:token/render", async (c) => {
    const u = c.get("user"); limit(`rjb:${u.id}`, 5, 60_000); const x = ownShare(c); const b = await body(c, RS.RenderReq);
    if (x.revokedAt) throw new ApiErr("conflict", "This replay link was revoked.");
    if (x.render.status === "queued" || x.render.status === "rendering") throw new ApiErr("conflict", "A render is already in progress.");
    if (renderer.configured && [...store.replayShares.values()].filter((y) => y.render.status === "queued").length >= cfg.REPLAY_RENDER_MAX_QUEUE) throw new ApiErr("rate_limited", "The render queue is full. Try again in a few minutes.");
    queueRender(x, b); return c.json(RS.RenderJob.parse(rjView(x.render)), 202);
  });
  r.delete("/replays/:token", (c) => { const x = ownShare(c); if (!x.revokedAt) { x.revokedAt = clock.now(); x.render.jobId = null; if (x.render.status === "queued") x.render.status = "none"; if (renderer.name === "ffmpeg") removeRender(cfg.REPLAY_RENDER_DIR, x.token); store.audit.push({ at: clock.now(), userId: x.ownerId, action: "replay.revoke", target: x.runId }); } return c.body(null, 204); });
  app.get("/public/replays/:token", (c) => {
    pubLimit(c, "rpl", 60);
    const tk = c.req.param("token"); const x = RS.ReplayShareToken.safeParse(tk).success ? store.replayShares.get(tk) : undefined;
    const run = x && !x.revokedAt ? store.runs.get(x.runId) : undefined;
    if (!x || !run || run.ownerId !== x.ownerId) throw new ApiErr("not_found", "Replay not found.");
    const owner = store.users.get(x.ownerId); const { runId: _r, ...rep } = x.replay as Record<string, unknown>;
    c.header("cache-control", "public, max-age=30"); c.header("x-robots-tag", "noindex");
    return c.json(RS.PublicReplay.parse({ ...rep, token: x.token, title: x.title, handle: owner ? publicHandle(handleOf(owner)) : "@trader", strategyName: store.strategies.get(run.strategyId)?.versions.find((v) => v.version === run.strategyVersion)?.strategy.name ?? "Strategy",
      mode: run.mode, createdAt: iso(x.createdAt), render: { status: x.render.status, videoUrl: x.render.videoUrl, posterUrl: x.render.posterUrl } }));
  });
  // M5.15: rendered files, served only for live (not revoked) shares with a finished ffmpeg render.
  const serveRender = (kind: "video" | "poster") => (c: Context<Env>) => {
    pubLimit(c, "rpv", 30);
    const tk = c.req.param("token") ?? ""; const x = RS.ReplayShareToken.safeParse(tk).success ? store.replayShares.get(tk) : undefined;
    if (!x || x.revokedAt || x.render.status !== "done" || renderer.name !== "ffmpeg") throw new ApiErr("not_found", "Video not found.");
    let p: string, size: number; try { p = renderPaths(cfg.REPLAY_RENDER_DIR, x.token)[kind]; size = _st(p).size; } catch { throw new ApiErr("not_found", "Video not found."); }
    if (size > cfg.REPLAY_RENDER_MAX_BYTES) throw new ApiErr("not_found", "Video not found.");
    c.header("content-type", kind === "video" ? "video/mp4" : "image/png"); c.header("content-length", String(size)); c.header("x-content-type-options", "nosniff");
    c.header("content-disposition", `inline; filename="${kind === "video" ? "replay.mp4" : "poster.png"}"`); c.header("cache-control", "public, max-age=300"); c.header("x-robots-tag", "noindex");
    c.header("content-security-policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(_rf(p)));
  };
  app.get("/public/replays/:token/video.mp4", serveRender("video"));
  app.get("/public/replays/:token/poster.png", serveRender("poster"));
  // ---------- M4.9 instruct: text -> proposed diff -> explicit apply (paper only) ----------
  const INSTRUCT_TTL_MS = 15 * 60_000;
  const insView = (x: typeof store.instructs extends Map<string, infer V> ? V : never) => {
    if (x.status === "proposed" && clock.now() >= x.expiresAt) x.status = "expired";
    const { strategy: _s, ownerId: _o, createdAt, expiresAt, appliedAt, ...rest } = x;
    return IN.InstructProposal.parse({ ...rest, createdAt: iso(createdAt), expiresAt: iso(expiresAt), appliedAt: appliedAt == null ? null : iso(appliedAt) });
  };
  const instructRun = (c: Context<Env>) => {
    const run = ownRun(c, c.req.param("id") ?? "");
    if (run.mode !== "paper") throw new ApiErr("mode_not_enabled", "Instructions can only change paper runs.");
    if (run.status === "stopped" || !runs.live.get(run.id)) throw new ApiErr("conflict", "This run has stopped. Start it again to change it.", { runStatus: run.status });
    const s = store.strategies.get(run.strategyId)!; return { run, s };
  };
  r.post("/runs/:id/instruct", async (c) => {
    const u = c.get("user"); limit(`ins:${u.id}`, 10, 60_000); limit(`insd:${u.id}:${today()}`, 100, 86_400_000);
    const b = await body(c, IN.InstructReq); const { run, s } = instructRun(c);
    const latest = s.versions.at(-1)!; const base = latest.strategy;
    chargeCompile(u);
    // M4.9.2: a refused proposal (422: unsupported text or a change that breaks the strategy) gives the quota slot back.
    // AI cost stays bounded by the 10/min + 100/day instruct limits and the global LLM budget.
    try {
    const ik = userAiKey(u) ?? cfg.OPENROUTER_API_KEY; // M5.13: the user's own AI key wins here too
    const out = await instructCompile(b.text, base, { registry, openrouter: ik ? { apiKey: ik, model: cfg.LLM_MODEL ?? "openai/gpt-4.1-mini", budget: llmBudget } : undefined });
    if (!out.ok) throw new ApiErr("unsupported_prompt", out.message, { suggestions: out.suggestions });
    const { strategy: next, changes } = applyOps(base, out.ops, registry);
    const v0 = validateStrategy(next, { registry, stockTokensAllowed: true }); const issues = [...v0.issues, ...geoNote(u, v0.strategy)];
    // M4.9.1: a diff that breaks the strategy is refused up front with friendly, de-duplicated issues (never raw zod text)
    if (!v0.strategy || hasErrors(issues)) throw new ApiErr("strategy_invalid", issues.some((i) => i.code === "strategy_needs_rule") ? "A strategy needs at least one active rule" : "This change would make the strategy invalid.", dedupe(issues.filter((i) => i.severity === "error")));
    for (const x of store.instructs.values()) if (x.runId === run.id && x.status === "proposed") x.status = "superseded";
    const row = { id: newId("ins", clock.now()), runId: run.id, ownerId: u.id, strategyId: s.id, baseVersion: latest.version, text: b.text, ops: out.ops, changes, issues, ok: !!v0.strategy && !hasErrors(issues),
      compiler: out.compiler, notice: out.notice, status: "proposed" as const, createdAt: clock.now(), expiresAt: clock.now() + INSTRUCT_TTL_MS, appliedAt: null, appliedVersion: null, strategy: next };
    store.instructs.set(row.id, row);
    store.audit.push({ at: clock.now(), userId: u.id, action: "run.instruct.propose", target: run.id, meta: { proposalId: row.id, ops: out.ops.map((o) => o.op), compiler: out.compiler } });
    return c.json(insView(row), 201);
    } catch (e) { if (e instanceof ApiErr && (e.code === "unsupported_prompt" || e.code === "strategy_invalid") && u.compiles.day === today() && u.compiles.n > 0) u.compiles.n--; throw e; }
  });
  r.post("/runs/:id/instruct/:pid/apply", (c) => {
    const u = c.get("user"); limit(`insa:${u.id}`, 10, 60_000);
    const { run, s } = instructRun(c);
    const x = store.instructs.get(c.req.param("pid") ?? ""); if (!x || x.runId !== run.id || x.ownerId !== u.id) throw new ApiErr("not_found", "Proposal not found.");
    insView(x);
    if (x.status !== "proposed") throw new ApiErr("conflict", `This proposal is ${x.status}.`, { status: x.status });
    if (s.versions.at(-1)!.version !== x.baseVersion) { x.status = "superseded"; throw new ApiErr("conflict", `Strategy changed (now v${s.versions.at(-1)!.version}). Send the instruction again.`, { status: "superseded" }); }
    const sv = saveVersion(c, x.strategy); // same validation + geo note as create
    if (hasErrors(sv.issues)) throw new ApiErr("strategy_invalid", "The change makes the strategy invalid.", sv.issues);
    const v = validateStrategy(sv.strategy, { registry, stockTokensAllowed: geoGate(run.mode, u) }); // same gate as run start
    if (hasErrors(v.issues)) throw new ApiErr("strategy_invalid", "Strategy can't run as-is.", v.issues);
    const version = x.baseVersion + 1; s.versions.push({ version, ...sv }); s.updatedAt = clock.now();
    runs.swapStrategy(run.id, sv.strategy, version, `Strategy updated to v${version}: ${(x.changes as { summary: string }[]).map((ch) => ch.summary).join("; ")}`);
    x.status = "applied"; x.appliedAt = clock.now(); x.appliedVersion = version;
    store.audit.push({ at: clock.now(), userId: u.id, action: "run.instruct.apply", target: run.id, meta: { proposalId: x.id, version } });
    return c.json(IN.InstructApplyRes.parse({ proposal: insView(x), strategyVersion: version, runId: run.id }));
  });
  app.get("/public/cards/:token", (c) => {
    pubLimit(c, "card", 60);
    const tk = c.req.param("token"); const row = PB.CardShareToken.safeParse(tk).success ? store.cardShares.get(tk) : undefined;
    const run = row && !row.revokedAt ? store.runs.get(row.runId) : undefined;
    if (!row || !run || run.ownerId !== row.ownerId) throw new ApiErr("not_found", "Card not found.");
    const sm = runs.summary(run); const st = store.strategies.get(run.strategyId); const ver = st?.versions.find((v) => v.version === run.strategyVersion) ?? st?.versions.at(-1);
    const pts = equitySeries(runs.equityCurve(run.id, 200), run.startingEquity); const end = run.stoppedAt ?? clock.now();
    const owner = store.users.get(run.ownerId);
    c.header("cache-control", "public, max-age=5"); c.header("x-robots-tag", "noindex");
    return c.json(PB.PublicCard.parse({
      strategyName: ver?.strategy.name ?? "Strategy", handle: owner ? publicHandle(handleOf(owner)) : "@trader", mode: run.mode, status: run.status === "starting" ? "running" : run.status,
      venues: ver ? venuesOf(ver.strategy) : [], startedAt: sm.startedAt, stoppedAt: sm.stoppedAt, durationSec: Math.max(0, Math.floor((end - run.startedAt) / 1000)),
      returnPct: sm.pnlPct, maxDrawdownPct: dec(pts.reduce((m, p) => Math.max(m, Number(p.drawdownPct)), 0), 2),
      trades: run.events.filter((e) => e.type === "fill").length, triggerFires: run.events.filter((e) => e.type === "trigger_fired").length,
      spark: pctSpark(thin(pts.map((p) => Number(p.equityUsd)), 30), run.startingEquity), synthetic: mkt.synthetic, sharedAt: iso(row.createdAt), asOf: iso(clock.now()),
      disclaimer: run.mode === "paper" ? `Paper trading${mkt.synthetic ? " on synthetic prices" : ""}. Not real money; past results are not a promise of future returns.` : "Testnet. Not real money; past results are not a promise of future returns.",
    }));
  });

  const LANDING_PREVIEW_RETRY_MS = 60_000;
  // ---------- v1.2 (M3.8): landing (guest, read-only) ----------
  const previewCache = new Map<string, Promise<z.infer<typeof X.LandingPreview> | null>>();
  let previewFailedAt: number | null = null; // M4.5.2: a failed/empty preview is cached for LANDING_PREVIEW_RETRY_MS only
  const landingPreview = () => {
    const to = Math.floor(clock.now() / 3_600_000) * 3_600_000; const key = String(to);
    if (previewFailedAt !== null && clock.now() - previewFailedAt >= LANDING_PREVIEW_RETRY_MS) { previewCache.clear(); previewFailedAt = null; }
    if (!previewCache.has(key)) {
      previewCache.clear();
      const p = publics().find((x) => x.id === LANDING_PREVIEW_ID);
      previewCache.set(key, !p ? Promise.resolve(null) : runBacktest({ strategy: p.strategy, from: to - 7 * 86_400_000, to, resolution: "1h", startingEquity: 10_000, feeModel: "default" }, { mkt, adapters, registry, stockTokensAllowed: true })
        .then((o) => {
          if (!o) return null; const res = o.result; const end = Number(res.endingEquityUsd);
          const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : n.toPrecision(4));
          const events = [
            ...res.triggerFires.map((f) => ({ ts: f.ts, type: "fired" as const, message: `Trigger "${f.triggerId}" fired` })),
            ...((net) => res.fills.map((f) => { const m = registry.get(f.instrument); const vn = m ? adapters[m.venue].name : f.instrument;
              const q = Number(f.qty) * (f.side === "sell" || f.side === "short" ? -1 : 1); const before = net.get(f.instrument) ?? 0; net.set(f.instrument, before + q);
              const verb = before !== 0 && Math.sign(before) !== Math.sign(q) ? "Closed" : f.side === "sell" ? "Sold" : f.side === "short" ? "Short" : f.side === "long" ? "Long" : "Bought";
              return { ts: f.ts, type: "fill" as const, message: `${verb} ${Math.abs(Number(f.qty)).toPrecision(3)} ${m?.symbol ?? f.instrument} at $${fmt(Number(f.price))} · ${vn} (paper)` }; }))(new Map<string, number>()),
          ].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-6);
          return X.LandingPreview.parse({ strategyId: p.id, name: p.strategy.name, author: { handle: p.handle, isYou: false }, from: iso(to - 7 * 86_400_000), to: iso(to), startingEquityUsd: usd(10_000), equityUsd: res.endingEquityUsd, pnlUsd: usd(end - 10_000), pnlPct: dec(((end - 10_000) / 10_000) * 100, 2), trades: res.trades, points: thin(res.equitySeries.map((e) => Number(e.equityUsd)), 24), events, synthetic: mkt.synthetic });
        }).catch(() => null).then((v) => { if (v === null) previewFailedAt = clock.now(); return v; }));
    }
    return previewCache.get(key)!;
  };
  app.get("/public/landing", async (c) => {
    pubLimit(c, "landing", 60);
    const vs = venueInfo(); const cap = new Map(vs.map((v) => [v.id, v.capabilities]));
    const trades = LANDING_TRADES.map((t) => ({ ...t, venues: [...t.venues], status: t.venues.some((v) => cap.get(v)?.includes("paper")) ? "paper" as const : "watch_only" as const }));
    const featured = (await Promise.all(publics().map((p) => summaryOf(p, null)))).sort((a, b) => Number(b.paperReturn30dPct ?? -1e9) - Number(a.paperReturn30dPct ?? -1e9)).slice(0, 3);
    const prices = pricesPhrase(cfg.PRICE_SOURCE); // M4.5.2: the configured source, not the composite market's synthetic flag
    c.header("cache-control", "public, max-age=60");
    return c.json(X.LandingRes.parse({
      mode: cfg.QUIVR_MODE, venues: vs, trades, signals: LANDING_SIGNALS.map((x) => ({ ...x, signalKinds: [...x.signalKinds] })),
      skills: SKILLS.map((x) => ({ ...x, venues: [...x.venues] })), featured, preview: await landingPreview(),
      asOf: iso(clock.now()), mock: cfg.QUIVR_MODE === "mock", notice: LANDING_NOTICE.replace("{prices}", prices),
    }));
  });

  // ---------- M3.7 operator routes (OPS_TOKEN) ----------
  // Unset OPS_TOKEN = every ops route is 404 (indistinguishable from a missing route). Run list/stop is also 404 when
  // NODE_ENV=production or on mainnet: it exists to clean up orphan PAPER/TESTNET runs on a dev or preview box.
  const opsDigest = cfg.OPS_TOKEN ? createHash("sha256").update(cfg.OPS_TOKEN).digest() : null;
  const opsRunsAllowed = (cfg.NODE_ENV ?? "").trim().toLowerCase() !== "production" && (cfg.QUIVR_MODE === "mock" || cfg.QUIVR_MODE === "testnet") && cfg.CHAIN_ID !== 4663;
  const notFound = () => new ApiErr("not_found", "Route not found.");
  const opsAuth = (c: Context<any>, runsRoute: boolean) => {
    if (!opsDigest || (runsRoute && !opsRunsAllowed)) throw notFound();
    limit(`ops:${clientIp(c)}`, 30, 60_000);
    const h = c.req.header("authorization"); const tok = h?.startsWith("Bearer ") ? h.slice(7) : "";
    if (!timingSafeEqual(createHash("sha256").update(tok).digest(), opsDigest)) throw new ApiErr("unauthorized", "Operator token required.");
  };
  const opsRun = (run: (typeof store.runs extends Map<string, infer R> ? R : never)) => ({ ...runs.summary(run), ownerId: run.ownerId, ownerLabel: store.users.get(run.ownerId)?.label ?? null });
  let shuttingDown = false;
  app.post("/ops/shutdown", (c) => {
    opsAuth(c, false);
    store.audit.push({ at: clock.now(), userId: "ops", action: "ops.shutdown", target: "process" });
    const res = O.OpsShutdownRes.parse({ ok: true, shuttingDown: true, activeRuns: runs.live.size });
    if (!shuttingDown) { shuttingDown = true; setTimeout(() => o.onShutdown?.(), 50); } // after the response is flushed
    return c.json(res, 202);
  });
  app.get("/ops/runs", (c) => {
    opsAuth(c, true); const q = query(c, O.OpsRunsQuery);
    const items = [...store.runs.values()].filter((r) => r.mode !== "live" && (q.status === "all" || r.status !== "stopped")).sort((a, b) => a.startedAt - b.startedAt).map(opsRun);
    return c.json(O.OpsRunsRes.parse({ items, asOf: iso(clock.now()) }));
  });
  app.post("/ops/runs/:id/stop", async (c) => {
    opsAuth(c, true);
    const id = c.req.param("id"); const run = store.runs.get(id);
    if (!run || run.mode === "live") throw new ApiErr("not_found", "Run not found.");
    const already = run.status === "stopped";
    if (!already) {
      if (runs.live.has(id)) await runs.control(id, "stop");
      else { run.status = "stopped"; run.stoppedAt = clock.now(); } // halted / not resumed: just mark stopped
      store.audit.push({ at: clock.now(), userId: "ops", action: "ops.run.stop", target: id });
      persist?.touch();
    }
    return c.json(O.OpsStopRes.parse({ run: opsRun(run), alreadyStopped: already }));
  });

  app.route("/", r);

  // ---------- SSE (ticket auth; registered on app so the bearer middleware doesn't apply) ----------
  app.get("/runs/:id/events/stream", (c) => sseRun(c));

  function sseRun(c: Context<any>) {
    const runId = c.req.param("id"); const ticket = c.req.query("ticket") ?? "";
    const p = verifyJwt<{ sub: string; run: string; typ: string; jti?: string; exp: number }>(ticket, secret, clock.now());
    if (!p || p.typ !== "stream" || p.run !== runId || !p.jti) throw new ApiErr("unauthorized", "Stream ticket invalid or expired.");
    const now = clock.now(); for (const [j, exp] of usedTickets) if (exp <= now) usedTickets.delete(j);
    if (usedTickets.has(p.jti)) throw new ApiErr("unauthorized", "Stream ticket already used. Request a new one.");
    const run = store.runs.get(runId); if (!run || run.ownerId !== p.sub) throw new ApiErr("not_found", "Run not found.");
    const open = sseOpen.get(p.sub) ?? 0; // M3.5 per-user concurrent SSE cap
    if (open >= cfg.MAX_SSE_PER_USER) throw new ApiErr("limit_exceeded", `Up to ${cfg.MAX_SSE_PER_USER} live streams per account. Close a tab and retry.`, { limit: cfg.MAX_SSE_PER_USER, open, kind: "streams" }, 5);
    usedTickets.set(p.jti, p.exp * 1000); sseOpen.set(p.sub, open + 1);
    let released = false; const release = () => { if (released) return; released = true; const n = (sseOpen.get(p.sub) ?? 1) - 1; if (n <= 0) sseOpen.delete(p.sub); else sseOpen.set(p.sub, n); };
    const lastId = c.req.header("last-event-id") ?? c.req.query("since");
    const since = lastId !== undefined && /^-?\d+$/.test(lastId) ? Number(lastId) : run.events.length - 1;
    return streamSSE(c, async (s) => {
      s.onAbort(release);
      await new Promise<void>((resolve) => {
        let unsub = () => {};
        const sub = new SseSubscriber({ write: (f) => s.writeSSE(f) }, since, { heartbeatMs: cfg.SSE_HEARTBEAT_MS, maxQueue: cfg.SSE_MAX_QUEUE, now: () => Date.now() }, () => { clearInterval(watch); unsub(); release(); resolve(); });
        unsub = runs.subscribe(runId, (e) => sub.push(e));
        const watch = setInterval(() => { if (run.status === "stopped" && !runs.live.has(runId)) setTimeout(() => sub.close(), 200); }, 500); watch.unref?.();
        s.onAbort(() => sub.close());
        sub.start(runs.snapshotFrames(runId), run.events).catch(() => sub.close());
      });
    });
  }

  return { app, store, runs, alerts, autopilot, replays: { processRenders }, secrets: { userRpcFor }, rateLimit: { size: () => rl.size, prune: rlPrune, max: RL_MAX }, persist: persist ? { path: persist.path, flush: () => persist.flush(), stats: persist.stats, stop: () => { if (persistTimer) clearInterval(persistTimer); persist.flushSync(); } } : null, mkt, registry, adapters, setKillSwitch: (v: boolean) => { killSwitch = v; if (v) for (const l of runs.live.values()) runs.haltExternal(l.run.id, "kill_switch", "Trading paused platform-wide."); } };
}
export type QuiverApp = ReturnType<typeof createApp>;
