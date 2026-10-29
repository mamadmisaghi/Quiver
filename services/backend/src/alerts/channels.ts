// M5.8 chat-channel alert adapters (Telegram, X). M5.14: real senders behind env tokens.
// No token -> status "not_configured" and nothing is sent. With a token -> status "ok": one bounded HTTPS call per attempt
// (timeout, one quick in-attempt retry on network/5xx, 429 honoured), plus local rate limits so we stay under platform caps.
// Fixed API hosts only (api.telegram.org, api.x.com); user input is only ever a chat id / handle, never a URL.
// Tokens never appear in errors, logs or responses.
import type { AlertProvider, DeliveryCtx, SendResult } from "./service";

export interface ChannelAdapter extends AlertProvider {
  name: "telegram" | "x"; label: string; /** "not_configured" = no token; "ok" = live sender ("stub" kept for older clients, no longer emitted) */
  status: "ok" | "stub" | "not_configured";
  /** Normalized target or null when invalid. */ normalizeTarget(raw: string): string | null; targetHint: string;
  render(message: string, runId: string | null): string; maxLen: number;
}
/** Low-level JSON HTTP call. Injected in tests (no real network). */
export type ChannelHttp = (req: { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ status: number; json: unknown; retryAfterSec?: number | null }>;
export const CHANNEL_TIMEOUT_MS = 5_000; export const CHANNEL_MAX_RESPONSE = 64_000;
export const fetchChannelHttp: ChannelHttp = async (q) => {
  const r = await fetch(q.url, { method: q.method, headers: q.headers, body: q.body, redirect: "error", signal: AbortSignal.timeout(q.timeoutMs) });
  const t = (await r.text()).slice(0, CHANNEL_MAX_RESPONSE); let json: unknown = null; try { json = JSON.parse(t); } catch { /* non-JSON */ }
  const ra = Number(r.headers.get("retry-after")); return { status: r.status, json, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null };
};
export interface ChannelOpts { http?: ChannelHttp; now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }

/** Sliding-window limiter: global + per target. */
export class Limiter {
  private g: number[] = []; private per = new Map<string, number[]>();
  constructor(private gMax: number, private gWin: number, private tMax: number, private tWin: number, private now: () => number) {}
  take(target: string): number | null { // null = ok, else seconds to wait
    const t = this.now(); this.g = this.g.filter((x) => x > t - this.gWin); const p = (this.per.get(target) ?? []).filter((x) => x > t - this.tWin);
    if (this.g.length >= this.gMax) return Math.ceil((this.g[0] + this.gWin - t) / 1000);
    if (p.length >= this.tMax) return Math.ceil((p[0] + this.tWin - t) / 1000);
    this.g.push(t); p.push(t); this.per.set(target, p); if (this.per.size > 10_000) this.per.delete(this.per.keys().next().value!); return null;
  }
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
const clean = (s: string) => s.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
const redact = (s: string, tok: string) => (tok ? s.split(tok).join("[redacted]") : s).slice(0, 200);
type Attempt = (target: string, text: string) => Promise<{ status: number; json: unknown; retryAfterSec?: number | null }>;

function adapter(a: Omit<ChannelAdapter, "send" | "configured" | "status">, token: string | undefined, o: ChannelOpts, lim: Limiter, attempt: Attempt, okOf: (r: { status: number; json: any }) => boolean, finalErr: (r: { status: number; json: any }) => string | null): ChannelAdapter {
  const tok = token?.trim() ?? ""; const status = tok ? "ok" as const : "not_configured" as const; const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  return { ...a, configured: !!tok, status,
    send: async (c: DeliveryCtx): Promise<SendResult> => {
      if (!tok) return { ok: false, retry: false, notConfigured: true, error: `${a.label} alerts are not configured yet.` };
      const target = c.target ? a.normalizeTarget(c.target) : null;
      if (!target) return { ok: false, retry: false, error: `No valid ${a.label} destination set.` };
      const wait = lim.take(target); if (wait !== null) return { ok: false, retry: true, status: 429, error: `${a.label} rate limit reached locally; retrying in ~${wait}s.` };
      const text = c.text ?? a.render(c.body, null);
      for (let i = 0; i < 2; i++) { // one quick retry inside the attempt for transient failures; the delivery queue does the rest
        try {
          const r = await attempt(target, text);
          if (okOf(r as any)) return { ok: true, status: r.status };
          if (r.status === 429) return { ok: false, retry: true, status: 429, error: `${a.label} rate limited${r.retryAfterSec ? `; retry after ${Math.min(r.retryAfterSec, 3600)}s` : ""}.` };
          if (r.status >= 500 && i === 0) { await sleep(250); continue; }
          const fe = finalErr(r as any);
          return { ok: false, retry: r.status >= 500 || r.status === 408, status: r.status, error: redact(fe ?? `${a.label} HTTP ${r.status}`, tok) };
        } catch (e) { if (i === 0) { await sleep(250); continue; } return { ok: false, retry: true, error: redact(`${a.label} request failed: ${(e as Error).message}`, tok) }; }
      }
      return { ok: false, retry: true, error: `${a.label} unavailable.` };
    } };
}

export const telegramAdapter = (token?: string, o: ChannelOpts = {}) => {
  const http = o.http ?? fetchChannelHttp; const t = o.timeoutMs ?? CHANNEL_TIMEOUT_MS; const now = o.now ?? Date.now;
  return adapter({ name: "telegram", label: "Telegram", maxLen: 4096, targetHint: "numeric chat id (e.g. 123456789 or -1001234567890) or @channelname",
    normalizeTarget: (r) => { const x = r.trim(); return /^-?\d{5,16}$/.test(x) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(x) ? x : null; },
    render: (m, runId) => clip(`Quiver alert\n${clean(m)}${runId ? `\nRun ${runId}` : ""}`, 4096) }, token, o,
    new Limiter(25, 1000, 20, 60_000, now), // Telegram: ~30 msg/s per bot, 20/min per group
    async (chat, text) => { const r = await http({ method: "POST", url: `https://api.telegram.org/bot${token!.trim()}/sendMessage`, headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: clip(text, 4096), disable_web_page_preview: true }), timeoutMs: t });
      const ra = (r.json as any)?.parameters?.retry_after; return { ...r, retryAfterSec: r.retryAfterSec ?? (typeof ra === "number" ? ra : null) }; },
    (r) => r.status === 200 && r.json?.ok === true,
    (r) => r.status === 403 ? "Telegram refused: the bot can't message that chat (start the bot or add it to the channel)." : r.status === 400 ? `Telegram rejected the message: ${String(r.json?.description ?? "bad request").slice(0, 120)}` : r.status === 401 ? "Telegram token rejected." : null);
};

export const xAdapter = (token?: string, o: ChannelOpts = {}) => {
  const http = o.http ?? fetchChannelHttp; const t = o.timeoutMs ?? CHANNEL_TIMEOUT_MS; const now = o.now ?? Date.now;
  const ids = new Map<string, string>(); // handle -> user id (bounded cache)
  const auth = () => ({ authorization: `Bearer ${token!.trim()}`, "content-type": "application/json" });
  return adapter({ name: "x", label: "X", maxLen: 280, targetHint: "your X handle, 4–15 letters, digits or _ (e.g. @alice_q); alerts arrive as a DM",
    normalizeTarget: (r) => { const x = r.trim().replace(/^@?/, "@"); return /^@[A-Za-z0-9_]{4,15}$/.test(x) && !/twitter|admin/i.test(x) && !/^@\d+$/.test(x) ? x : null; } /* M5.10: X handle rules */,
    render: (m) => clip(`Quiver alert: ${clean(m)}`, 280) }, token, o,
    new Limiter(100, 15 * 60_000, 5, 60_000, now), // X DMs: stay well under 200/15 min per user, 5/min per recipient
    async (handle, text) => {
      let id = ids.get(handle.toLowerCase());
      if (!id) { const u = await http({ method: "GET", url: `https://api.x.com/2/users/by/username/${encodeURIComponent(handle.slice(1))}`, headers: auth(), timeoutMs: t });
        if (u.status !== 200) return u; const got = (u.json as any)?.data?.id; if (typeof got !== "string" || !/^\d{1,20}$/.test(got)) return { status: 404, json: { detail: "user not found" } };
        id = got; if (ids.size > 5000) ids.clear(); ids.set(handle.toLowerCase(), id); }
      return http({ method: "POST", url: `https://api.x.com/2/dm_conversations/with/${id}/messages`, headers: auth(), body: JSON.stringify({ text: clip(text, 280) }), timeoutMs: t });
    },
    (r) => (r.status === 200 || r.status === 201) && !!r.json?.data,
    (r) => r.status === 404 ? "X user not found." : r.status === 403 ? "X refused the DM (the recipient must allow DMs from this account)." : r.status === 401 ? "X token rejected." : null);
};
