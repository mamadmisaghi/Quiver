// Display formatting for contract Decimal strings. Formatting only — no arithmetic on money values.
export const isNeg = (d: string | null | undefined) => !!d && d.trim().startsWith("-");
export const isZero = (d: string | null | undefined) => !!d && /^-?0+(\.0+)?$/.test(d);
export function fmtUsd(d: string | null | undefined, opts: { sign?: boolean; dp?: number } = {}) {
  if (d == null) return "—";
  const dp = opts.dp ?? 2;
  const n = Number(d);
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sign = isNeg(d) && !isZero(d) ? "−" : opts.sign && !isZero(d) ? "+" : "";
  return `${sign}$${s}`;
}
export function fmtPct(d: string | null | undefined, opts: { sign?: boolean; dp?: number } = {}) {
  if (d == null) return "—";
  const s = Math.abs(Number(d)).toFixed(opts.dp ?? 2);
  return `${isNeg(d) && !isZero(d) ? "−" : opts.sign && !isZero(d) ? "+" : ""}${s}%`;
}
export const fmtNum = (d: string | null | undefined, dp = 2) => (d == null ? "—" : Number(d).toLocaleString("en-US", { maximumFractionDigits: dp }));
export const tone = (d: string | null | undefined) => (d == null || isZero(d) ? "text-muted" : isNeg(d) ? "text-short" : "text-long");
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
export function fmtAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`;
}
/** Signal values are numbers/strings/booleans or null (= waiting for data, never 0). */
export function fmtSignal(id: string, v: number | string | boolean | null, stale = false) {
  if (v == null || stale) return "waiting";
  if (typeof v !== "number") return String(v);
  if (id.includes("odds")) return `${(v * 100).toFixed(1)}%`;
  if (id.includes("funding")) return `${(v * 100).toFixed(4)}%`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---------- Human copy for contract enums (never show raw snake_case in the UI) ----------
// M3.2 §15: mock_* sources are simulated prices, whatever venue they imitate.
const SOURCE: Record<string, string> = {
  chainlink_stream: "Chainlink", chainlink_mainnet_readonly: "Chainlink", mock_chainlink: "Simulated", chainlink: "Chainlink",
  uniswap_quote: "Uniswap", uniswap: "Uniswap", pool_twap: "Pool TWAP", venue_mid: "Venue mid", hyperliquid: "Hyperliquid", mock_hyperliquid: "Simulated",
  polymarket: "Polymarket", mock_polymarket: "Simulated", jupiter: "Jupiter", mock_jupiter: "Simulated", synthetic: "Simulated", mock_synthetic: "Simulated",
  modeled_eod_tiingo: "Modeled", jupiter_readonly: "Jupiter", none: "—", vendor: "Data vendor",
  mock: "Simulated", mock_pool: "Simulated", calendar: "Calendar", timer: "Timer", portfolio: "Portfolio",
};
export const humanize = (s: string) => s.replace(/^mock_/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
/** QA P0: never throws. Known sources get their label; mock_* is Simulated; anything else is a generic label. */
export const sourceLabel = (src: unknown): string => {
  if (typeof src !== "string" || !src) return "—";
  if (Object.prototype.hasOwnProperty.call(SOURCE, src)) return SOURCE[src];
  if (src.startsWith("mock")) return "Simulated";
  return "Price source";
};
export const fmtSource = (src: unknown, at?: string | null, now?: number) => {
  let ago = ""; try { ago = at && now ? ` · ${fmtAgo(at, now)}` : ""; } catch { ago = ""; }
  return sourceLabel(src) + ago;
};
export const EVENT_LABEL: Record<string, string> = {
  status: "Status", tick: "Checked signals", trigger_met: "Conditions met", trigger_fired: "Trigger fired", intent: "Order placed",
  fill: "Filled", error: "Order failed", risk_halt: "Risk limit hit", heartbeat: "Heartbeat",
  approval_requested: "Needs approval", approval_resolved: "Approval",
};
export const RUN_STATUS: Record<string, string> = { starting: "Starting", running: "Running", paused: "Paused", stopped: "Stopped", halted: "Halted" };
export const HALT_RULE: Record<string, string> = {
  max_daily_loss: "Daily loss limit", max_orders_per_day: "Daily order limit", max_total_exposure: "Exposure limit", session_key_cap: "Session key spend cap",
  session_key_expired: "Session key expired", session_key_revoked: "Session key revoked", oracle_sequencer_down: "Price feed offline", geo_block: "Region restriction", kill_switch: "Trading paused platform-wide",
};
export const fmtDur = (sec: number) => sec >= 3600 ? `${Math.round(sec / 360) / 10} h` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${Math.max(0, Math.round(sec))}s`;
export const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };
export const DEMO_LABEL = process.env.NEXT_PUBLIC_API_MODE === "live" ? "Paper mode · live prices" : "Paper mode · demo data";

/** Human copy for API error / rejection codes (server message is the fallback). */
export const ERROR_COPY: Record<string, string> = {
  secrets_unavailable: "Saving keys isn’t switched on for this server yet.", rpc_url_blocked: "That RPC address isn’t allowed. Use a public https URL on port 443 or 8443.", vision_unavailable: "Reading chart images isn’t available right now. Describe the idea in words instead.", image_invalid: "That image couldn’t be used.", auth_unavailable: "Sign-in isn’t switched on for this server yet. Nothing is wrong with your account.", wallet_link_unavailable: "Wallet linking isn’t available yet.", wallet_link_invalid: "That signature didn’t match. Nothing was linked; start again.",
  unsupported_prompt: "Quiver couldn't turn that into rules yet. Try naming a ticker, a price or % move, and an amount.", compile_failed: "Couldn't draft that strategy. Try rephrasing.", market_closed: "The stock market is closed. Robinhood Stock Token orders wait for the next NYSE session.",
  geo_restricted: "Stock Tokens aren't available in your region yet.", oracle_stale: "The price feed is stale, so no order was placed.",
  quote_unavailable: "No quote was available. It will retry on the next check.", venue_unavailable: "That venue is unavailable right now.",
  sequencer_down: "Robinhood Chain is paused. Orders wait until it's back.", mode_not_enabled: "Paper only for now — live trading isn't enabled yet.",
  risk_cap: "This order would break one of your risk limits.", rate_limited: "Too many requests. Try again in a moment.",
  not_available: "Coming soon. This isn't available yet.",
  payload_too_large: "That prompt is too long. Shorten it, or attach smaller images.",
  not_found: "We couldn't find that. It may have been removed.",
  limit_exceeded: "You've hit a usage limit. Try again in a moment.",
  run_halted: "The run is halted by a risk rule, so no new order was placed. Exits still go through.", run_paused: "The run is paused, so no new order was placed. Resume it to trade again.",
  backtest_range_invalid: "That date range can't be backtested. Pick dates within the last 365 days, ending no later than now.",
};
const rec = (d: unknown): Record<string, unknown> => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});
/** M3.5: copy for 429 limit_exceeded (per-user caps: active_runs, streams). */
export function limitCopy(details: unknown): string {
  const d = rec(details), n = Number(d.limit);
  if (d.kind === "active_runs") return `You have ${Number.isFinite(n) ? n : 5} paper runs going. Stop one to start another.`;
  if (d.kind === "streams") return `You have ${Number.isFinite(n) ? n : 10} live views open. Close a tab to watch this one. Retrying shortly…`;
  return ERROR_COPY.limit_exceeded;
}
/** M3.5: 422 backtest_range_invalid → guidance plus the bound to clamp to (null if the server gave none). */
export function rangeGuidance(details: unknown): { text: string; clampTo?: { from?: string; to?: string } } {
  const d = rec(details), at = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const day = (v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (d.reason === "future") { const t = at(d.latestTo); return { text: `The range ends in the future. Backtests can only run up to ${t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "now"}.`, clampTo: t ? { to: t } : undefined }; }
  if (d.reason === "before_data") { const f = at(d.earliestFrom); return { text: `The range starts before our price history${f ? ` (earliest ${day(f)})` : ""}. Backtests cover the last 365 days.`, clampTo: f ? { from: f } : undefined }; }
  return { text: ERROR_COPY.backtest_range_invalid };
}
/** M3.5: client-side check matching the API (decimal string, 100 … 10,000,000 inclusive; no exponents). */
export const EQUITY_MIN = 100, EQUITY_MAX = 10_000_000;
export function checkEquity(v: string): string | null {
  const t = v.replace(/[,\s$]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Enter a dollar amount, like 10000.";
  const n = Number(t);
  return n < EQUITY_MIN || n > EQUITY_MAX ? "Starting balance must be between $100 and $10,000,000." : null;
}
/** M4.9.1: 422 validation_failed | strategy_invalid → details: [{ path, code, message, severity? }] (de-duplicated, max 20).
 *  Tolerant: anything that isn't that shape gives []. */
export type FieldIssue = { path: string; code: string; message: string; severity?: string };
/** M5.28: error.details is either an issue array (schema 422s), or an object. A schema 422 for too many decimals is
 *  { reason: "too_many_decimals", issues: [...] }; domain errors are { reason, ... }. Branch on the type, never on message text. */
export function detailsOf(details: unknown): { reason?: string; issues: unknown[]; obj: Record<string, unknown> } {
  if (Array.isArray(details)) return { issues: details, obj: {} };
  const o = rec(details);
  return { reason: typeof o.reason === "string" ? o.reason : undefined, issues: Array.isArray(o.issues) ? o.issues : [], obj: o };
}
/** details.reason of an error (object details only; issue arrays have no reason). */
export const reasonOf = (x: unknown): string | undefined => detailsOf((x as { details?: unknown } | null)?.details).reason;
export function issuesOf(details: unknown): FieldIssue[] {
  return detailsOf(details).issues.flatMap((d) => { const r = rec(d); return typeof r.message === "string" && r.message ? [{ path: typeof r.path === "string" ? r.path : "", code: typeof r.code === "string" ? r.code : "invalid_value", message: r.message, severity: typeof r.severity === "string" ? r.severity : undefined }] : []; }).slice(0, 20);
}
export const isValidation = (x: unknown) => { const c = (x as { code?: unknown } | null)?.code; return c === "validation_failed" || c === "strategy_invalid"; };
/** Map issue paths (JSON pointer, e.g. "/guardrails/maxDrawdownPct") to form fields: the last segment that names a
 *  field wins, or pass `map` for explicit pointers. Returns { fields, rest } — rest = issues with no matching field. */
export function fieldErrors<K extends string>(x: unknown, fields: readonly K[], map: Partial<Record<string, K>> = {}): { fields: Partial<Record<K, string>>; rest: FieldIssue[] } {
  const out: Partial<Record<K, string>> = {}, rest: FieldIssue[] = [];
  if (!isValidation(x)) return { fields: out, rest };
  for (const i of issuesOf((x as { details?: unknown }).details)) {
    const segs = i.path.split("/").filter(Boolean);
    const k = map[i.path] ?? ([...segs].reverse().find((s) => (fields as readonly string[]).includes(s)) as K | undefined);
    if (k && !out[k]) out[k] = i.message; else if (!k) rest.push(i);
  }
  return { fields: out, rest };
}
/** Human copy for any thrown error: details-aware for M3.5 codes, else ERROR_COPY, else the server message. */
export function errOf(x: unknown, fallback: string): string {
  const e = x as { code?: string; message?: string; details?: unknown } | null;
  if (!e || typeof e.code !== "string") return fallback;
  if (isValidation(e)) { const i = issuesOf(e.details); return i.length === 1 ? i[0].message : e.message || fallback; }
  if (e.code === "limit_exceeded") return limitCopy(e.details);
  if (e.code === "backtest_range_invalid") return rangeGuidance(e.details).text;
  return errCopy(e.code, e.message);
}
export const errCopy = (code: string, msg?: string) => ERROR_COPY[code] ?? msg ?? "Something went wrong.";
export const SESSION_LABEL: Record<string, string> = { open: "Market open", closed: "Market closed", pre: "Pre-market", post: "After hours", halted: "Halted", always: "24/7" };

/** M3.4: tooltip for the 24h change, from Market.change24hSource. */
export function change24hTitle(pct: string | null | undefined, src: "computed" | "vendor" | null | undefined): string {
  if (pct == null) return "No 24h change yet";
  return src === "computed" ? "24h change, computed from our prices vs. 24 hours ago" : src === "vendor" ? "24h change, as reported by the price source" : "24h change";
}
/** M3.6 SessionAccount terms. Window cap = the key's daily cap (dailyCapUsd); the contract keeps 64 spends per window,
 *  so the minimum swap is ceil(windowCap / 64) and grant() needs windowCap ≤ 64 × perTxCap. slippageCapBps is the
 *  owner's on-chain cap (default 100 = 1%; setSlippageCap raises it up to the 10% ceiling). */
export const SESSION_KEY = { maxSpendsPerWindow: 64, defaultSlippageCapBps: 100, hardCeilingBps: 1000, defaultPerTxCapUsd: "250", defaultWindowCapUsd: "1000" } as const;
/** Minimum swap in USD, rounded up to the cent like the contract rounds up in token units. */
export const minSwapUsd = (windowCapUsd: string | number, n: number = SESSION_KEY.maxSpendsPerWindow) => {
  const w = Number(windowCapUsd); return Number.isFinite(w) && w > 0 && n > 0 ? Math.ceil((w * 100) / n - 1e-9) / 100 : null;
};
/** Default max slippage for a new grant: 1%, or the owner's cap if they raised/lowered it (never above 10%). */
export const defaultSlippageBps = (ownerCapBps?: number | null) =>
  Math.min(SESSION_KEY.hardCeilingBps, ownerCapBps && ownerCapBps > 0 ? ownerCapBps : SESSION_KEY.defaultSlippageCapBps);
/** M4: "hl:perp:SOL" → "SOL perp", "robinhood:token:TSLA" → "TSLA", "polymarket:…:yes" → last segment upper-cased. */
export function fmtInstrument(id: string): string {
  const p = id.split(":"); const last = (p[p.length - 1] ?? id).toUpperCase();
  return p[1] === "perp" ? `${last} perp` : last;
}

/** M5.22: machine-readable warmup (history/backtest `warmupNotice`). Branch on the code, never on message text. */
export const warmupMsg = (n: { code: string; message: string } | null | undefined): string | null => (n?.code === "warming_up" ? n.message : null);
export const WARMUP_SHORT = "warming up"; // full sentence in title + sr-only
