// M4.0 alert delivery: rules match run events → deliveries in a retry queue → provider (ALERTS_PROVIDER).
import { createHmac, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { z } from "zod";
import { ALERT_MAX_ATTEMPTS, ALERT_RETRY_BACKOFF_SEC, type AlertDelivery, type AlertEventType, type AlertProviderName, type AlertRule, type AlertSettings, type AlertWebhookPayload } from "../../contracts/src/alerts";
import type { RunEvent } from "../../contracts/src/events";
import { iso } from "../lib/clock";
import { newId } from "../lib/ids";
import type { RunRow } from "../store";
import type { ChannelAdapter } from "./channels";
import { checkUrlShape, DnsTimeout, resolvePublic, systemResolver, type Resolver } from "./ssrf";

export interface AlertRuleRow { id: string; ownerId: string; runId: string | null; events: z.infer<typeof AlertEventType>[]; enabled: boolean; createdAt: number }
export interface AlertDeliveryRow { id: string; ownerId: string; ruleId: string | null; runId: string | null; kind: "run_event" | "test"; event: RunEvent | null; message: string; provider: z.infer<typeof AlertProviderName>; status: z.infer<typeof AlertDelivery>["status"]; attempts: number; lastError: string | null; lastStatusCode: number | null; nextAttemptAt: number | null; createdAt: number; deliveredAt: number | null }
export interface AlertUserCfg { webhookUrl: string | null; secret: string | null; /** M5.8 */ targets?: Partial<Record<"telegram" | "x", string>> }

/** Result of one send attempt. retry=false ends the delivery. */
export type SendResult = { ok: true; status: number } | { ok: false; retry: boolean; error: string; status?: number; notConfigured?: boolean };
export interface DeliveryCtx { url: string | null; secret: string | null; body: string; deliveryId: string; ts: number; /** M5.8 chat channels */ target?: string | null; text?: string }
export interface AlertProvider { name: z.infer<typeof AlertProviderName>; configured: boolean; send(c: DeliveryCtx): Promise<SendResult> }
/** Low-level HTTPS POST pinned to a pre-validated address. Injected in tests. */
export type Transport = (u: URL, pinned: { address: string; family: number }, headers: Record<string, string>, body: string) => Promise<number>;

export const DELIVERY_DEADLINE_MS = 10_000; // M4.2.1: total wall-clock budget per attempt (connect + TLS + send + response)
export const MAX_RESPONSE_BYTES = 64 * 1024; // M4.2.1: response body beyond this aborts the attempt
export const DNS_TIMEOUT_MS = 3_000; // M4.5.1: webhook DNS lookup budget (retryable when exceeded)
export const DELIVERY_CONCURRENCY = 8; // M4.2.1: global in-flight attempts; one destination is serialised
/** Pinned HTTPS POST. `ca` is a test hook (self-signed local server); production uses the system trust store. */
export function makeHttpsTransport(o: { deadlineMs?: number; maxBytes?: number; ca?: string | Buffer } = {}): Transport {
  const deadline = o.deadlineMs ?? DELIVERY_DEADLINE_MS, maxBytes = o.maxBytes ?? MAX_RESPONSE_BYTES;
  return (u, pinned, headers, body) => new Promise((res, rej) => {
    let done = false; const finish = (f: () => void) => { if (!done) { done = true; clearTimeout(timer); f(); } };
    const ac = new AbortController();
    const req = httpsRequest({ host: u.hostname, servername: u.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, ""), port: u.port || 443, path: u.pathname + u.search, method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, timeout: deadline, signal: ac.signal, ...(o.ca ? { ca: o.ca } : {}),
      // M4.2.1 (gate P1-1): Node >=20 autoSelectFamily calls lookup with {all:true} and expects an array.
      lookup: (_h: string, opt: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => opt?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family) } as never,
    (r) => { // redirects are not followed; the body is drained up to maxBytes and discarded
      let n = 0; const st = r.statusCode ?? 0;
      r.on("data", (c: Buffer) => { n += c.length; if (n > maxBytes) { finish(() => rej(new Error("response too large"))); req.destroy(); } });
      r.on("end", () => finish(() => res(st))); r.on("error", (e) => finish(() => rej(e)));
    });
    const timer = setTimeout(() => { finish(() => rej(new Error("deadline exceeded"))); ac.abort(); req.destroy(); req.socket?.destroy(); }, deadline);
    req.on("timeout", () => { finish(() => rej(new Error("deadline exceeded"))); req.destroy(); });
    req.on("error", (e) => finish(() => rej(e))); req.end(body);
  });
}
export const httpsTransport: Transport = makeHttpsTransport();

export const signPayload = (secret: string, ts: number, body: string) => "v1=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

/** Test-only SSRF allowance (local TLS test server). Ignored when NODE_ENV=production. */
export interface TestAllow { addresses: string[]; ports: string[] }
export function webhookProvider(resolve: Resolver = systemResolver, transport: Transport = httpsTransport, testAllow?: TestAllow): AlertProvider {
  const allow = process.env.NODE_ENV === "production" ? undefined : testAllow;
  return { name: "webhook", configured: true, async send(c) {
    if (!c.url || !c.secret) return { ok: false, retry: false, error: "No webhook URL set." };
    let u: URL, pinned; try { u = checkUrlShape(c.url, allow?.ports); pinned = await resolvePublic(u, resolve, allow?.addresses, DNS_TIMEOUT_MS); } catch (e) { return { ok: false, retry: e instanceof DnsTimeout, error: (e as Error).message }; }
    try {
      const st = await transport(u, pinned, { "content-type": "application/json", "user-agent": "Quiver-Alerts/1", "x-quiver-delivery": c.deliveryId, "x-quiver-timestamp": String(c.ts), "x-quiver-signature": signPayload(c.secret, c.ts, c.body) }, c.body);
      if (st >= 200 && st < 300) return { ok: true, status: st };
      return { ok: false, retry: st === 0 || st === 408 || st === 429 || st >= 500 /* 3xx not followed, other 4xx final */, error: `HTTP ${st}`, status: st };
    } catch (e) { return { ok: false, retry: true, error: String((e as Error).message).slice(0, 200) }; }
  } };
}
const stub = (name: "email" | "telegram" | "x"): AlertProvider => ({ name, configured: false, send: async () => ({ ok: false, retry: false, error: `${name} alerts are not configured yet.`, notConfigured: true }) });

export const MAX_RULES_PER_USER = 20;
export const MAX_QUEUED_PER_USER = 200;

export class AlertService {
  rules = new Map<string, AlertRuleRow>(); deliveries = new Map<string, AlertDeliveryRow>(); users = new Map<string, AlertUserCfg>();
  provider: AlertProvider; channels: Map<string, ChannelAdapter>; private inflight = new Set<string>();
  constructor(private o: { provider: z.infer<typeof AlertProviderName>; now: () => number; resolve?: Resolver; transport?: Transport; concurrency?: number; testAllow?: TestAllow; channels?: ChannelAdapter[] }) {
    this.channels = new Map((o.channels ?? []).map((a) => [a.name, a]));
    this.provider = o.provider === "webhook" ? webhookProvider(o.resolve, o.transport, o.testAllow) : this.channels.get(o.provider as "x") ?? stub(o.provider);
  }
  settings(uid: string): z.infer<typeof AlertSettings> { const u = this.users.get(uid); return { provider: this.provider.name, providerStatus: this.provider.configured ? "ok" : "not_configured", webhookUrl: u?.webhookUrl ?? null, signingSecretSet: !!u?.secret }; }
  /** Validates the URL (shape + DNS) before saving. Returns the new secret only when created/rotated. */
  async setWebhook(uid: string, url: string | null, rotate = false): Promise<string | null> {
    const u = this.users.get(uid) ?? { webhookUrl: null, secret: null };
    if (url !== null) { const p = checkUrlShape(url); await resolvePublic(p, this.o.resolve ?? systemResolver); }
    u.webhookUrl = url; let fresh: string | null = null;
    if (url === null) u.secret = null; else if (!u.secret || rotate) fresh = u.secret = "whsec_" + randomBytes(32).toString("hex");
    this.users.set(uid, u); return fresh;
  }
  addRule(uid: string, r: { runId: string | null; events: AlertRuleRow["events"]; enabled: boolean }) {
    if ([...this.rules.values()].filter((x) => x.ownerId === uid).length >= MAX_RULES_PER_USER) return null;
    const row: AlertRuleRow = { id: newId("alr", this.o.now()), ownerId: uid, runId: r.runId, events: [...new Set(r.events)], enabled: r.enabled, createdAt: this.o.now() };
    this.rules.set(row.id, row); return row;
  }
  ruleView = (r: AlertRuleRow): z.infer<typeof AlertRule> => ({ id: r.id, runId: r.runId, events: r.events, enabled: r.enabled, createdAt: iso(r.createdAt) });
  deliveryView = (d: AlertDeliveryRow): z.infer<typeof AlertDelivery> => ({ id: d.id, ruleId: d.ruleId, runId: d.runId, kind: d.kind, eventType: d.event?.type ?? "test", eventSeq: d.event?.seq ?? null, provider: d.provider, status: d.status, attempts: d.attempts, lastError: d.lastError, lastStatusCode: d.lastStatusCode, nextAttemptAt: d.nextAttemptAt === null ? null : iso(d.nextAttemptAt), createdAt: iso(d.createdAt), deliveredAt: d.deliveredAt === null ? null : iso(d.deliveredAt) });

  /** Hook from RunManager.emit: one delivery per matching enabled rule. Never throws. */
  onRunEvent(run: RunRow, ev: RunEvent) {
    for (const r of this.rules.values()) {
      if (r.ownerId !== run.ownerId || !r.enabled || (r.runId && r.runId !== run.id) || !r.events.includes(ev.type as AlertRuleRow["events"][number])) continue;
      this.enqueueAll(run.ownerId, r.id, run.id, "run_event", ev, describe(ev));
    }
  }
  /** M5.8: the primary delivery plus one per extra chat channel the user set a target for. */
  enqueueAll(uid: string, ruleId: string | null, runId: string | null, kind: "run_event" | "test", ev: RunEvent | null, message: string) {
    const out = [this.enqueue(uid, ruleId, runId, kind, ev, message)];
    for (const [name, t] of Object.entries(this.users.get(uid)?.targets ?? {})) if (t && name !== this.provider.name && this.channels.has(name)) out.push(this.enqueue(uid, ruleId, runId, kind, ev, message, name as "x"));
    return out;
  }
  enqueue(uid: string, ruleId: string | null, runId: string | null, kind: "run_event" | "test", ev: RunEvent | null, message: string, provider: z.infer<typeof AlertProviderName> = this.provider.name) {
    const now = this.o.now();
    const queued = [...this.deliveries.values()].filter((d) => d.ownerId === uid && d.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
    if (queued.length >= MAX_QUEUED_PER_USER) { const old = queued[0]; old.status = "dropped"; old.nextAttemptAt = null; old.lastError = "Queue full; oldest alert dropped."; }
    const d: AlertDeliveryRow = { id: newId("ald", now), ownerId: uid, ruleId, runId, kind, event: ev, message, provider, status: "queued", attempts: 0, lastError: null, lastStatusCode: null, nextAttemptAt: now, createdAt: now, deliveredAt: null };
    this.deliveries.set(d.id, d); return d;
  }
  payload(d: AlertDeliveryRow): z.infer<typeof AlertWebhookPayload> { return { v: 1, deliveryId: d.id, kind: d.kind, ruleId: d.ruleId, runId: d.runId, event: d.event, message: d.message, sentAt: iso(this.o.now()) }; }
  /** Attempt every due queued delivery once. Backoff ALERT_RETRY_BACKOFF_SEC; ALERT_MAX_ATTEMPTS then failed.
   *  M4.2.1: deliveries are grouped per destination (owner's webhook URL) and run serially inside a group; groups run in parallel up to
   *  DELIVERY_CONCURRENCY, so one slow receiver only delays its own alerts. A delivery already in flight is never picked twice. */
  async process(): Promise<number> {
    const now = this.o.now(); const groups = new Map<string, AlertDeliveryRow[]>();
    const busy = new Set([...this.inflight].map((id) => this.destOf(id))); // destinations owned by an earlier process() call
    for (const d of this.deliveries.values()) {
      if (d.status !== "queued" || d.nextAttemptAt === null || d.nextAttemptAt > now || this.inflight.has(d.id)) continue;
      const key = this.destOf(d.id)!;
      if (busy.has(key)) continue; // that destination is still being served by an earlier round
      this.inflight.add(d.id); (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
    }
    let n = 0;
    await Promise.all([...groups.values()].map(async (g) => { for (const d of g) { try { await this.guarded(d); n++; } finally { this.inflight.delete(d.id); } } }));
    return n;
  }
  /** M4.5.1: one attempt for exactly this delivery (POST /alerts/test), without waiting on a round. Still under the global cap. */
  async deliverNow(id: string): Promise<void> {
    const d = this.deliveries.get(id); if (!d || d.status !== "queued" || this.inflight.has(id)) return;
    this.inflight.add(id); try { await this.guarded(d); } finally { this.inflight.delete(id); }
  }
  // M4.5.1: service-wide semaphore — at most `concurrency` attempts in flight across ALL rounds and deliverNow calls.
  private active = 0; private waiters: (() => void)[] = [];
  /** test/ops visibility */ readonly peak = { inFlight: 0 };
  private async guarded(d: AlertDeliveryRow) {
    const max = this.o.concurrency ?? DELIVERY_CONCURRENCY;
    while (this.active >= max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++; this.peak.inFlight = Math.max(this.peak.inFlight, this.active);
    try { await this.attempt(d); } finally { this.active--; this.waiters.shift()?.(); }
  }
  private destOf(id: string) { const d = this.deliveries.get(id); if (!d) return null; if (d.provider !== "webhook") return `${d.provider}:${this.users.get(d.ownerId)?.targets?.[d.provider as "x"] ?? d.ownerId}`; return this.users.get(d.ownerId)?.webhookUrl ?? `owner:${d.ownerId}`; }
  private async attempt(d: AlertDeliveryRow) {
    const now = this.o.now(); const u = this.users.get(d.ownerId); const body = JSON.stringify(this.payload(d)); d.attempts++;
    // deliveryId = d.id: identical on every retry of the same alert (receivers dedupe on X-Quiver-Delivery).
    const ch = this.channels.get(d.provider); const p: AlertProvider = d.provider === this.provider.name ? this.provider : ch ?? stub(d.provider as "x");
    const target = d.provider === "webhook" ? null : u?.targets?.[d.provider as "x"] ?? null;
    const r = await p.send({ url: u?.webhookUrl ?? null, secret: u?.secret ?? null, body, deliveryId: d.id, ts: Math.floor(now / 1000), target, text: ch?.render(d.message, d.runId) });
    if (r.ok) { d.status = "delivered"; d.deliveredAt = this.o.now(); d.nextAttemptAt = null; d.lastStatusCode = r.status; d.lastError = null; return; }
    d.lastError = r.error; d.lastStatusCode = r.status ?? null;
    if (r.notConfigured) { d.status = "not_configured"; d.nextAttemptAt = null; }
    else if (!r.retry || d.attempts >= ALERT_MAX_ATTEMPTS) { d.status = "failed"; d.nextAttemptAt = null; }
    else d.nextAttemptAt = now + ALERT_RETRY_BACKOFF_SEC[d.attempts - 1] * 1000;
  }
}

export function describe(ev: RunEvent): string {
  switch (ev.type) {
    case "fill": return `Paper ${ev.side} ${ev.instrument} $${Number(ev.notionalUsd).toFixed(2)} at ${ev.price}`;
    case "risk_halt": return `Run halted: ${ev.message}`;
    case "rejected": return `Order rejected (${ev.code}): ${ev.message}`;
    case "error": return `Run error (${ev.code}): ${ev.message}`;
    case "warning": return `Warning (${ev.code}): ${ev.message}`;
    case "trigger_fired": return `Trigger ${ev.triggerId} fired`;
    case "status": return `Run ${ev.status}${ev.reason ? `: ${ev.reason}` : ""}`;
    default: return ev.type;
  }
}

/** M5.8 channel settings view. */
export function channelView(a: ChannelAdapter, cfg: AlertUserCfg | undefined, primary: string) { return { name: a.name, label: a.label, primary: a.name === primary, status: a.status, target: cfg?.targets?.[a.name] ?? null, targetHint: a.targetHint, maxMessageLength: a.maxLen }; }
