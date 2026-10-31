// Live adapter: QuiverApi against Sage's /v1 REST + SSE (backend/api-contracts.md).
// Auth: POST /v1/auth/exchange → Bearer access token (memory only; never in a URL). Dev builds use a
// `dev:<label>` idToken (NEXT_PUBLIC_DEV_LOGIN=1) until Privy is wired. SSE uses short-lived stream tickets.
import type * as CT from "@/lib/contracts";
// QA P2 LCP: zod + the contracts (~47 KB gz) load on first API use instead of before first paint.
type CM = typeof CT;
let cLoad: Promise<CM> | null = null;
const contracts = () => (cLoad ??= import("@/lib/contracts"));
import { STRATEGY_RAW } from "./fixtures";
import { ApiErr, type QuiverApi, type Run } from "./types";
import { emitSession, markSignedIn, wasSignedIn } from "./session";
import { errCopy, limitCopy } from "./format";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/v1";
const DEV_LOGIN = process.env.NEXT_PUBLIC_DEV_LOGIN === "1";
let token: string | null = null;
let authing: Promise<void> | null = null;
export const setAccessToken = (t: string | null) => { token = t; };

/** Random hex that also works outside a secure context (plain-http previews have no crypto.randomUUID). */
export function randomHex(chars: number): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") { let h = ""; while (h.length < chars) h += c.randomUUID().replace(/-/g, ""); return h.slice(0, chars); }
  const b = new Uint8Array(Math.ceil(chars / 2));
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b); else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, chars);
}
// The refresh cookie is Secure, so over plain http the browser drops it: skip /auth/refresh (a guaranteed 401) and
// keep the in-memory session until reload; dev builds silently re-exchange the saved dev label on reload.
const insecure = () => typeof window !== "undefined" && window.isSecureContext === false;
let noted = false;
const noteInsecure = () => { if (!noted) { noted = true; console.info("[quiver] insecure context: refresh cookie unavailable, session is in-memory only"); } };
function devIdToken() {
  const k = "quiver.devIdToken";
  let v = localStorage.getItem(k);
  if (!v) { v = "dev:web" + randomHex(21); localStorage.setItem(k, v); } // dev: + 24 chars
  return v;
}
/** M3.4: /auth/exchange and /auth/refresh are rate limited (429). Back off (Retry-After or 2^n s, max 3 tries)
 *  and publish a quiet "retrying" state the shell can show. */
type AuthRetry = { retryInSec: number } | null;
const authListeners = new Set<(s: AuthRetry) => void>();
export const onAuthRetry = (cb: (s: AuthRetry) => void) => { authListeners.add(cb); return () => { authListeners.delete(cb); }; };
const emitAuth = (s: AuthRetry) => authListeners.forEach((f) => f(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** M3.6: server's wait for a 429: Retry-After header, else body error.retryAfterSec / details.retryAfter. */
export async function retryAfterSec(r: Response): Promise<number | null> {
  const ok = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const h = ok(r.headers.get("retry-after")); if (h) return h;
  const b = (await r.clone().json().catch(() => null)) as { error?: { retryAfterSec?: unknown; details?: { retryAfter?: unknown } } } | null;
  return ok(b?.error?.retryAfterSec) ?? ok(b?.error?.details?.retryAfter);
}
async function authPost(path: "/auth/exchange" | "/auth/refresh", body?: unknown): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(BASE + path, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status !== 429 || i >= 3) { emitAuth(null); return r; }
    const wait = Math.min(60, (await retryAfterSec(r)) ?? 2 ** (i + 1));
    emitAuth({ retryInSec: wait }); await sleep(wait * 1000);
  }
}
async function errFrom(r: Response): Promise<ApiErr> {
  // M3.6.1: every 429 carries Retry-After (header first, then error.retryAfterSec); read it before the body is consumed.
  const ra = r.status === 429 ? await retryAfterSec(r) : null;
  const C = await contracts(), b = await r.json().catch(() => null), p = C.ApiError.safeParse(b);
  if (p.success) return new ApiErr(p.data.error.code, p.data.error.message, r.status, p.data.error.details, ra);
  return new ApiErr(r.status === 413 ? "payload_too_large" : r.status === 429 ? "rate_limited" : "internal", r.statusText || "Request failed", r.status, undefined, ra);
}
const NEED = () => new ApiErr("unauthorized", "Sign in to load your data.", 401);
/** QA P1: sessions are explicit. Restore silently (refresh cookie, or a dev login this browser already chose),
 *  otherwise throw unauthorized so screens show a Sign in button (signIn below). Never auto-create a session. */
async function ensureAuth() {
  if (token) return;
  if (typeof window === "undefined") throw NEED();
  authing ??= (async () => {
    // QA P2: a browser that never signed in has no refresh cookie, so skip /auth/refresh (an expected 401 that
    // would only add console noise) and go straight to the quiet signed-out state.
    if (!wasSignedIn()) throw NEED();
    if (insecure()) { noteInsecure(); if (DEV_LOGIN) return exchange(); throw NEED(); }
    const rr = await authPost("/auth/refresh").catch(() => null);
    if (rr?.ok) { const C = await contracts(); token = C.AuthExchangeRes.pick({ accessToken: true }).parse(await rr.json()).accessToken; return; }
    if (rr?.status === 429) throw await errFrom(rr);
    if (DEV_LOGIN && wasSignedIn()) return exchange();
    throw NEED();
  })().finally(() => { authing = null; });
  return authing;
}
async function exchange() {
  const C = await contracts();
  const r = await authPost("/auth/exchange", C.AuthExchangeReq.parse({ provider: "privy", idToken: devIdToken() }));
  if (!r.ok) throw await errFrom(r);
  token = C.AuthExchangeRes.parse(await r.json()).accessToken;
}
/** User-initiated sign-in (Sign in button). Dev builds exchange a dev:<label> token (fallback when Privy is off). */
export const signInAvailable = DEV_LOGIN;
export async function signIn(): Promise<void> {
  if (!DEV_LOGIN) throw new ApiErr("unauthorized", "Sign-in isn't available in this preview yet.", 401);
  await exchange(); markSignedIn(true); emitSession();
}
/** M5.2: exchange a Privy identity token. 503 auth_unavailable until the server has Privy keys (fail closed). */
export async function signInWithPrivy(idToken: string): Promise<void> {
  const C = await contracts();
  const r = await authPost("/auth/exchange", C.AuthExchangeReq.parse({ provider: "privy", idToken }));
  if (!r.ok) throw await errFrom(r);
  token = C.AuthExchangeRes.parse(await r.json()).accessToken; markSignedIn(true); emitSession();
}
/** Public, no session needed. Cached per page load. */
let cfg: Promise<import("./types").AuthConfig> | null = null;
export function fetchAuthConfig() {
  return (cfg ??= (async () => {
    const r = await fetch(BASE + "/auth/config", { credentials: "include" });
    if (!r.ok) throw await errFrom(r);
    return (await contracts()).AuthConfigRes.parse(await r.json());
  })().catch((e) => { cfg = null; throw e; }));
}
async function raw(path: string, init: RequestInit = {}, retry = true, guest = false): Promise<Response> {
  // guest: endpoint also works signed-out (/compile) — send no bearer rather than failing.
  try { await ensureAuth(); } catch (e) { if (!guest || !(e instanceof ApiErr) || e.code !== "unauthorized") throw e; }
  const r = await fetch(BASE + path, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (r.status === 401 && retry && token) { token = null; return raw(path, init, false, guest); }
  if (!r.ok) throw await errFrom(r);
  return r;
}
async function req<T>(pick: (c: CM) => { parse: (x: unknown) => T }, path: string, init: RequestInit = {}): Promise<T> {
  const [r, C] = await Promise.all([raw(path, init), contracts()]);
  return pick(C).parse(r.status === 204 ? null : await r.json());
}
const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v != null && p.set(k, String(v))); const s = p.toString(); return s ? `?${s}` : ""; };
const post = (b: unknown, idem = false): RequestInit => ({ method: "POST", body: JSON.stringify(b), headers: idem ? { "idempotency-key": randomHex(32) } : {} });
const Ticket = { parse: (x: unknown) => x as { ticket: string } };

let demoRun: Promise<Run> | null = null;
async function ensureDemoRun(): Promise<Run> {
  const live = (await req((C) => C.Page(C.Run), "/runs" + qs({ mode: "paper" }))).items.find((r) => r.status === "running" || r.status === "starting" || r.status === "paused");
  if (live) return live;
  // M3.1: paper never returns 451, so the NVDA demo strategy runs directly (no fork fallback).
  const rec = await req((C) => C.StrategyRecord, "/strategies", post({ strategy: STRATEGY_RAW }, true));
  return req((C) => C.Run, "/runs", post({ strategyId: rec.id, mode: "paper" }, true));
}

/** Parse a text/event-stream body into (event, data) pairs. */
async function sse(r: Response, on: (ev: string, data: string) => void) {
  const rd = r.body!.pipeThrough(new TextDecoderStream()).getReader(); let buf = "";
  const flush = (blk: string) => { let ev = "message", data = ""; for (const l of blk.split(/\r?\n/)) { const i = l.indexOf(":"); if (i <= 0) continue; const k = l.slice(0, i), v = l.slice(i + 1).replace(/^ /, ""); if (k === "event") ev = v; else if (k === "data") data += (data ? "\n" : "") + v; } if (data) on(ev, data); };
  for (;;) { const { value, done } = await rd.read(); if (done) break; buf += value; const b = buf.split(/\r?\n\r?\n/); buf = b.pop()!; b.forEach(flush); }
  if (buf.trim()) flush(buf);
}

// M5.6: /compile and /compile/image share the NDJSON CompileEvent reader.
async function ndjson(path: string, body: unknown, onEvent: (e: CT.CompileEvent) => void, signal?: AbortSignal) {
  const [r, C] = await Promise.all([raw(path, { ...post(body), signal }, true, true), contracts()]);
  const rd = r.body!.pipeThrough(new TextDecoderStream()).getReader(); let buf = "";
  for (;;) { const { value, done } = await rd.read(); if (done) break; buf += value; const lines = buf.split("\n"); buf = lines.pop()!; lines.filter(Boolean).forEach((l) => onEvent(C.CompileEvent.parse(JSON.parse(l)))); }
}
export const liveApi: QuiverApi = {
  async autopilotPlanStream(body, onFrame, signal) {
    const [r, C] = await Promise.all([raw("/autopilot/plan/stream", { ...post(body), signal, headers: { accept: "text/event-stream" } }), contracts()]);
    await sse(r, (ev, d) => {
      const j = JSON.parse(d);
      if (ev === "status") onFrame({ event: ev, data: C.AutopilotPlanStatus.parse(j) });
      else if (ev === "candidate") onFrame({ event: ev, data: C.AutopilotPlanCandidate.parse(j) });
      else if (ev === "plan") onFrame({ event: ev, data: C.AutopilotPlan.parse(j) });
      else if (ev === "error") onFrame({ event: "error", data: { code: String(j.code ?? "internal"), message: String(j.message ?? "") } });
    });
  },
  autopilotPlan: (b) => req((C) => C.AutopilotPlan, "/autopilot/plan", post(b)),
  // M5.5 (backend 1e554b2): handle path segments are URL-encoded as-is
  profile: (h) => req((C) => C.Profile, `/profiles/${encodeURIComponent(h)}`),
  myProfile: () => req((C) => C.Profile, "/me/profile"),
  putMyProfile: (b) => req((C) => C.Profile, "/me/profile", { method: "PUT", body: JSON.stringify(b) }),
  follow: (h) => req((C) => C.FollowRes, `/profiles/${encodeURIComponent(h)}/follow`, post({})),
  unfollow: (h) => req((C) => C.FollowRes, `/profiles/${encodeURIComponent(h)}/follow`, { method: "DELETE" }),
  following: () => req((C) => C.FollowingRes, "/me/following"),
  copy: (b) => req((C) => C.CopyView, "/copy", post(b, true)),
  copies: () => req((C) => C.CopyListRes, "/copy"),
  // M5.12: cursor is opaque; an unknown cursor yields an empty page
  chainAccount: async (address) => {
    const [r, C] = await Promise.all([raw("/chain/testnet/accounts/" + encodeURIComponent(address)), contracts()]);
    const h = r.headers.get("x-quiver-rpc");
    return { res: C.AccountReadRes.parse(await r.json()), rpc: h === "user" || h === "server" ? h : null };
  },
  // M5.23–M5.25 testnet prepare endpoints (unsigned txs only; the wallet signs and sends)
  depositPrepare: (b) => req((C) => C.DepositPrepareRes, "/testnet/deposit/prepare", post(b)),
  testPoolStatus: async () => { const [r, C] = await Promise.all([fetch(BASE + "/testpool/status"), contracts()]); if (!r.ok) throw await errFrom(r); return C.TestPoolStatusRes.parse(await r.json()); },
  testPoolQuote: (side, amount) => req((C) => C.TestPoolQuoteRes, "/testpool/quote" + qs({ side, amount })),
  testPoolSwapPrepare: (b) => req((C) => C.TestPoolSwapPrepareRes, "/testpool/swap/prepare", post(b)),
  search: (q, limit = 6) => req((C) => C.SearchRes, "/search" + qs({ q, limit })),
  activity: ({ scope, handle, cursor, limit }) => req((C) => C.ActivityRes, "/activity" + qs(handle ? { handle, cursor, limit } : { scope, cursor, limit })),
  // M5.9 (bodies carry the secret; never logged — req() only surfaces ApiErr code/message)
  mySecrets: () => req((C) => C.UserSecretList, "/me/secrets"),
  putRpcSecret: (b) => req((C) => C.UserSecretView, "/me/secrets/rpc", { method: "PUT", body: JSON.stringify(b) }),
  putAiSecret: (b) => req((C) => C.UserSecretView, "/me/secrets/ai", { method: "PUT", body: JSON.stringify(b) }),
  deleteSecret: async (id) => { await raw(`/me/secrets/${encodeURIComponent(id)}`, { method: "DELETE" }); },
  // M5.8
  alertChannels: () => req((C) => C.AlertChannelList, "/alerts/channels"),
  putAlertChannel: (n, target) => req((C) => C.AlertChannel, `/alerts/channels/${encodeURIComponent(n)}`, { method: "PUT", body: JSON.stringify({ target }) }),
  // M5.7
  shareReplay: (id, b) => req((C) => C.ReplayShareView, `/runs/${encodeURIComponent(id)}/replay/share`, post(b, true)),
  myReplays: () => req((C) => C.ReplayShareList, "/me/replays"),
  renderReplay: (t, b) => req((C) => C.RenderJob, `/replays/${encodeURIComponent(t)}/render`, post(b)),
  revokeReplay: async (t) => { await raw(`/replays/${encodeURIComponent(t)}`, { method: "DELETE" }); },
  publicReplay: async (t) => { const [r, C] = await Promise.all([raw(`/public/replays/${encodeURIComponent(t)}`, {}, true, true), contracts()]); return C.PublicReplay.parse(await r.json()); }, // no auth needed
  syncCopy: (id) => req((C) => C.CopyView, `/copy/${encodeURIComponent(id)}/sync`, post({})),
  // M5.2 (backend f52bee4)
  authConfig: () => fetchAuthConfig(),
  walletLinkChallenge: (address) => req((C) => C.WalletLinkChallengeRes, "/wallets/link/challenge", post({ address }, true)),
  walletLinkVerify: (b) => req((C) => C.LinkedWalletsRes, "/wallets/link/verify", post(b, true)),
  myWallets: () => req((C) => C.LinkedWalletsRes, "/me/wallets"),
  unlinkWallet: (a) => req((C) => C.LinkedWalletsRes, `/me/wallets/${encodeURIComponent(a)}`, { method: "DELETE" }),
  // M5.1 (backend 82dfa59)
  marketDetail: (id) => req((C) => C.MarketDetailRes, `/markets/${encodeURIComponent(id)}/detail`),
  marketHistory: (id, q) => req((C) => C.MarketHistoryRes, `/markets/${encodeURIComponent(id)}/history?tf=${q.tf}&range=${q.range}`),
  me: () => req((C) => C.Me, "/me"),
  venues: () => req((C) => C.VenueInfo.array(), "/venues"),
  markets: (q = {}) => req((C) => C.Page(C.Market), "/markets" + qs(q)),
  strategies: (q = {}) => req((C) => C.ListStrategiesRes, "/strategies" + qs(q)),
  strategy: (id) => req((C) => C.StrategyRecord, `/strategies/${id}`),
  compile(body, onEvent, signal) { return ndjson("/compile", body, onEvent, signal); },
  compileImage(body, onEvent, signal) { return ndjson("/compile/image", body, onEvent, signal); },

  runs: (q = {}) => req((C) => C.Page(C.Run), "/runs" + qs(q)),
  run: (id) => req((C) => C.Run, `/runs/${id}`),
  createStrategy: (strategy) => req((C) => C.StrategyRecord, "/strategies", post({ strategy }, true)),
  updateStrategy: (id, strategy, expectedVersion) => req((C) => C.StrategyRecord, `/strategies/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ strategy, expectedVersion }) }),
  startRun: (b) => req((C) => C.Run, "/runs", post(b, true)),
  control: (id, action) => req((C) => C.Run, `/runs/${id}/control`, post({ action })),
  /** SSE over fetch (so we can read `retry:` and send Last-Event-ID). Each (re)connect mints a fresh ticket.
   *  - `retry` from the first snapshot frame sets the reconnect delay (default 3000 ms, backs off on repeated failure).
   *  - heartbeat {type, ts, lastSeq} keeps the cursor current; resync {reason, lastSeq} → reconnect at once with Last-Event-ID. */
  streamRun(id, onEvent, onIssue) {
    let closed = false, ended = false, lastSeq: number | null = null, retryMs = 3000, fails = 0, timer: ReturnType<typeof setTimeout> | undefined, ac: AbortController | null = null;
    const again = (now = false) => { if (closed || ended) return; /* W4: never reconnect a finished run */ const d = now ? 0 : Math.min(retryMs * 2 ** fails++, 30_000); timer = setTimeout(connect, d); };
    let C: CM | null = null;
    const frame = (ev: string, data: string, lid: string | null) => {
      if (!C) return;
      const p = C.RunStreamFrame.safeParse(JSON.parse(data));
      if (!p.success) { console.warn("unknown stream frame", ev); return; }
      const f = p.data;
      if (f.type === "heartbeat") { fails = 0; onEvent(f); return; } // control frame: no seq, never advances lastSeq
      if (f.type === "resync") { ac?.abort(); again(true); return "stop"; } // reconnect with Last-Event-ID = last seq we actually received
      if (lid != null && /^\d+$/.test(lid)) lastSeq = Number(lid); else lastSeq = Math.max(lastSeq ?? -1, f.seq);
      if (f.type === "status" && (f.status === "stopped" || (f.status as string) === "aborted")) ended = true;
      fails = 0; onEvent(f);
    };
    const connect = async () => {
      C ??= await contracts();
      ac = new AbortController();
      try {
        const { ticket } = await req(() => Ticket, "/stream-tickets", post({ runId: id }));
        if (closed) return;
        // M3.5: tickets are single-use, so every connect AND reconnect fetches a fresh one (above) and resumes from
        // lastSeq via since + Last-Event-ID. We use fetch, never native EventSource, whose auto-reconnect reuses the URL (→ 401).
        const since = lastSeq != null ? `&since=${lastSeq}` : "";
        const r = await fetch(`${BASE}/runs/${id}/events/stream?ticket=${encodeURIComponent(ticket)}${since}`, { signal: ac.signal, headers: { accept: "text/event-stream", ...(lastSeq != null ? { "last-event-id": String(lastSeq) } : {}) } });
        if (r.status === 429) {
          const e = await errFrom(r); // e.retryAfterSec: Retry-After header → error.retryAfterSec → details.retryAfter
          onIssue?.(e.code === "limit_exceeded" ? limitCopy(e.details) : errCopy(e.code, e.message));
          if (!closed) timer = setTimeout(connect, Math.min(60, e.retryAfterSec ?? 5) * 1000);
          return;
        }
        if (!r.ok || !r.body) throw r.ok ? new Error("stream body") : await errFrom(r);
        onIssue?.(null);
        const rd = r.body.pipeThrough(new TextDecoderStream()).getReader(); let buf = "";
        for (;;) {
          const { value, done } = await rd.read(); if (done) break; buf += value;
          const blocks = buf.split(/\r?\n\r?\n/); buf = blocks.pop()!;
          for (const blk of blocks) {
            let ev = "message", data = "", lid: string | null = null;
            for (const l of blk.split(/\r?\n/)) {
              const i = l.indexOf(":"); if (i === 0) continue; const k = i < 0 ? l : l.slice(0, i), v = i < 0 ? "" : l.slice(i + 1).replace(/^ /, "");
              if (k === "event") ev = v; else if (k === "data") data += (data ? "\n" : "") + v; else if (k === "id") lid = v; else if (k === "retry" && /^\d+$/.test(v)) retryMs = Number(v);
            }
            if (data && frame(ev, data, lid) === "stop") return;
          }
        }
        again();
      } catch (e) { if (e instanceof ApiErr && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 401) ended = true; /* W4: 404/409/410 = run gone or finished */ if (!ac?.signal.aborted || !closed) again(); }
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ac?.abort(); };
  },
  portfolio: (mode = "paper") => req((C) => C.Portfolio, "/portfolio" + qs({ mode })),
  sessionKeys: () => req((C) => C.Page(C.SessionKey), "/session-keys"),
  sessionKeyDefaults: () => req((C) => C.SessionKeyDefaults, "/session-keys/defaults"),
  prepareSessionKey: (b) => req((C) => C.PrepareSessionKeyRes, "/session-keys/prepare", post(b, true)),
  submitSessionKey: (b) => req((C) => C.SessionKey, "/session-keys/submit", post(b, true)),
  sessionKey: (id) => req((C) => C.SessionKey, `/session-keys/${id}`),
  alertSettings: () => req((C) => C.AlertSettings, "/alerts/settings"),
  putAlertSettings: (b) => req((C) => C.PutAlertSettingsRes, "/alerts/settings", { method: "PUT", body: JSON.stringify(b) }),
  alertRules: async () => (await req((C) => C.AlertRuleList, "/alerts/rules")).items,
  createAlertRule: (b) => req((C) => C.AlertRule, "/alerts/rules", post(b, true)),
  deleteAlertRule: async (id) => { await raw(`/alerts/rules/${id}`, { method: "DELETE" }); },
  alertDeliveries: (q = {}) => req((C) => C.AlertDeliveryList, "/alerts/deliveries" + qs(q)),
  testAlert: () => req((C) => C.AlertDelivery, "/alerts/test", post({}, true)),
  writeOffPreview: (id, inst) => req((C) => C.WriteOffPreviewRes, `/runs/${id}/positions/write-off?instrument=${encodeURIComponent(inst)}`),
  writeOff: (id, b) => req((C) => C.WriteOffRes, `/runs/${id}/positions/write-off`, post(b, true)),
  closePosition: (id, b) => req((C) => C.ClosePositionRes, `/runs/${id}/positions/close`, post(b, true)),
  runEvents: (id) => req((C) => ({ parse: (x: unknown) => ((x as { items: unknown[] }).items ?? []).map((i) => C.RunEvent.parse(i)) }), `/runs/${id}/events?limit=500`),
  portfolioRuns: (q = {}) => req((C) => C.PortfolioRuns, "/portfolio/runs" + qs(q)),
  portfolioAllocation: (q = {}) => req((C) => C.PortfolioAllocation, "/portfolio/allocation" + qs(q)),
  portfolioHistory: (q = {}) => req((C) => C.PortfolioHistory, "/portfolio/history" + qs(q)),
  positions: (q = {}) => req((C) => C.PositionsRes, "/positions" + qs(q)),
  runPositions: (id) => req((C) => C.PositionsRes, `/runs/${id}/positions`),
  replay: (id, q = {}) => req((C) => C.Replay, `/runs/${id}/replay` + qs(q)),
  autopilot: () => req((C) => C.Autopilot, "/autopilot"),
  putAutopilot: (b) => req((C) => C.Autopilot, "/autopilot", { method: "PUT", body: JSON.stringify(b) }),
  killAutopilot: () => req((C) => C.AutopilotKillRes, "/autopilot/kill", post({}, true)), // 200 | 207 partial (kill.failed[])
  autopilotLog: (q = {}) => req((C) => C.AutopilotLog, "/autopilot/log" + qs(q)),
  approvals: (q = {}) => req((C) => C.ApprovalList, "/approvals" + qs(q)),
  decideApproval: (id, decision) => req((C) => C.Approval, `/approvals/${id}`, post({ decision }, true)),
  backtest: (b) => req((C) => C.BacktestRes, "/backtests", post(b, true)),
  backtestStatus: (id) => req((C) => C.BacktestRes, `/backtests/${id}`),
  // v1.1
  equity: (runId, points = 200) => req((C) => C.EquitySeries, `/runs/${runId}/equity` + qs({ points })),
  publicStrategies: (q = {}) => req((C) => C.PublicStrategiesRes, "/public/strategies" + qs(q)),
  // M5.28: guest-readable; a bearer is sent only when a session already exists (author.isYou).
  publicStrategy: async (id) => { const [r, C] = await Promise.all([raw("/public/strategies/" + encodeURIComponent(id), {}, true, true), contracts()]); return C.PublicStrategyDetail.parse(await r.json()); },
  forkPublicStrategy: (id) => req((C) => C.StrategyRecord, `/public/strategies/${encodeURIComponent(id)}/fork`, post({}, true)),
  traders: (window = "30d") => req((C) => C.LeaderboardRes, "/traders" + qs({ window })),
  rewards: () => req((C) => C.RewardsRes, "/rewards"),
  revenue: () => req((C) => C.RevenueRes, "/revenue"),
  skills: async () => (await req((C) => C.SkillsRes, "/skills")).items,
  // v1.2: landing is public — fetch without touching auth so guests never trigger a sign-in.
  publicLeaderboard: async (q = {}) => { const [r, C] = await Promise.all([fetch(BASE + "/public/leaderboard" + qs(q)), contracts()]); if (!r.ok) throw await errFrom(r); return C.PublicLeaderboardRes.parse(await r.json()); },
  publicCard: async (t) => { const [r, C] = await Promise.all([fetch(BASE + `/public/cards/${encodeURIComponent(t)}`), contracts()]); if (!r.ok) throw await errFrom(r); return C.PublicCard.parse(await r.json()); },
  shareCard: (id) => req((C) => C.CardShareRes, `/runs/${id}/card/share`, post({})),
  revokeCard: (id) => req((C) => C.CardRevokeRes, `/runs/${id}/card/share`, { method: "DELETE" }),
  instruct: (id, text) => req((C) => C.InstructProposal, `/runs/${id}/instruct`, post({ text })),
  applyInstruct: (id, pid) => req((C) => C.InstructApplyRes, `/runs/${id}/instruct/${pid}/apply`, post({})),
  landing: async () => { const [r, C] = await Promise.all([fetch(BASE + "/public/landing"), contracts()]); if (!r.ok) throw await errFrom(r); return C.LandingRes.parse(await r.json()); },
  settings: () => req((C) => C.AccountSettingsRes, "/settings"),
  stopAll: (b = {}) => req((C) => C.StopAllRes, "/runs/stop-all", post(b, true)),
  runCard: (id) => req((C) => C.RunCard, `/runs/${id}/card`),
  async resolveRun(id) {
    // QA P1: never create runs as a side effect of viewing a URL. Only the id "demo" may auto-start the demo run;
    // anything else is fetched as-is and a 404 surfaces as not_found ("Run not found" state in LiveRun).
    if (id !== "demo") return req((C) => C.Run, `/runs/${encodeURIComponent(id)}`);
    demoRun ??= ensureDemoRun().catch((e) => { demoRun = null; throw e; });
    return demoRun;
  },
};
