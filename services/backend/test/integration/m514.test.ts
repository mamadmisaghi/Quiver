// M5.14 real Telegram / X senders behind env tokens. All HTTP is mocked; global fetch throws if anything escapes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { telegramAdapter, xAdapter, type ChannelHttp } from "../../src/alerts/channels";

const TG = "123456:TEST-placeholder-token"; const XT = "x-test-placeholder-token";
const real = globalThis.fetch; beforeEach(() => { globalThis.fetch = (async () => { throw new Error("real network call attempted"); }) as any; }); afterEach(() => { globalThis.fetch = real; });
const rec = (answers: Array<{ status: number; json: unknown; retryAfterSec?: number } | Error>) => { const calls: Parameters<ChannelHttp>[0][] = [];
  const http: ChannelHttp = async (q) => { calls.push(q); const a = answers.length > 1 ? answers.shift()! : answers[0]; if (a instanceof Error) throw a; return a; }; return { calls, http }; };
const ctx = (target: string | null, text = "Run stopped") => ({ url: null, secret: null, body: "{}", deliveryId: "d1", ts: 1, target, text });
let t0 = 0; const now = () => t0; const sleep = async () => {};

describe("M5.14 Telegram sender", () => {
  it("no token: not_configured and no HTTP", async () => {
    const h = rec([{ status: 200, json: { ok: true } }]); const a = telegramAdapter(undefined, { http: h.http }); expect(a.status).toBe("not_configured"); expect(a.configured).toBe(false);
    expect(await a.send(ctx("123456789"))).toMatchObject({ ok: false, notConfigured: true }); expect(h.calls).toHaveLength(0);
    expect(telegramAdapter("   ", { http: h.http }).status).toBe("not_configured");
  });
  it("sends sendMessage with chat id + text, bounded timeout; ok on {ok:true}", async () => {
    const h = rec([{ status: 200, json: { ok: true, result: {} } }]); const a = telegramAdapter(TG, { http: h.http, now, sleep, timeoutMs: 1234 });
    expect(a.status).toBe("ok"); expect(await a.send(ctx(" 123456789 ", "Hello"))).toEqual({ ok: true, status: 200 });
    expect(h.calls[0]).toMatchObject({ method: "POST", url: `https://api.telegram.org/bot${TG}/sendMessage`, timeoutMs: 1234 }); expect(JSON.parse(h.calls[0].body!)).toEqual({ chat_id: "123456789", text: "Hello", disable_web_page_preview: true });
  });
  it("one in-attempt retry on 5xx/network, then retryable; 429 honours retry_after; 4xx final; token never in errors", async () => {
    let h = rec([{ status: 502, json: null }, { status: 200, json: { ok: true } }]); expect((await telegramAdapter(TG, { http: h.http, now, sleep }).send(ctx("123456789"))).ok).toBe(true); expect(h.calls).toHaveLength(2);
    h = rec([new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TG}/sendMessage`)]); const r = await telegramAdapter(TG, { http: h.http, now, sleep }).send(ctx("123456789"));
    expect(r).toMatchObject({ ok: false, retry: true }); expect(JSON.stringify(r)).not.toContain(TG); expect(h.calls).toHaveLength(2);
    h = rec([{ status: 429, json: { ok: false, parameters: { retry_after: 7 } } }]); expect(await telegramAdapter(TG, { http: h.http, now, sleep }).send(ctx("123456789"))).toMatchObject({ ok: false, retry: true, status: 429, error: expect.stringContaining("7s") }); expect(h.calls).toHaveLength(1);
    h = rec([{ status: 403, json: { ok: false, description: "bot was blocked" } }]); expect(await telegramAdapter(TG, { http: h.http, now, sleep }).send(ctx("123456789"))).toMatchObject({ ok: false, retry: false, status: 403 });
    h = rec([{ status: 400, json: { ok: false, description: `bad ${TG}` } }]); expect(JSON.stringify(await telegramAdapter(TG, { http: h.http, now, sleep }).send(ctx("123456789")))).not.toContain(TG);
  });
  it("invalid target never calls out; local rate limit per chat (20/min) and global (25/s)", async () => {
    const h = rec([{ status: 200, json: { ok: true } }]); const a = telegramAdapter(TG, { http: h.http, now, sleep });
    expect(await a.send(ctx("https://evil.example"))).toMatchObject({ ok: false, retry: false }); expect(await a.send(ctx(null))).toMatchObject({ ok: false }); expect(h.calls).toHaveLength(0);
    t0 = 1_000_000; for (let i = 0; i < 20; i++) { t0 += 100; expect((await a.send(ctx("123456789"))).ok).toBe(true); }
    expect(await a.send(ctx("123456789"))).toMatchObject({ ok: false, retry: true, status: 429 }); expect(h.calls).toHaveLength(20);
    t0 += 61_000; expect((await a.send(ctx("123456789"))).ok).toBe(true);
    const b = telegramAdapter(TG, { http: h.http, now, sleep }); t0 = 5_000_000; let ok = 0; for (let i = 0; i < 30; i++) if ((await b.send(ctx(String(100000 + i)))).ok) ok++; expect(ok).toBe(25);
  });
});

describe("M5.14 X DM sender", () => {
  it("no token: not_configured, no HTTP", async () => { const h = rec([{ status: 200, json: {} }]); const a = xAdapter("", { http: h.http }); expect(a.status).toBe("not_configured"); expect((await a.send(ctx("@alice_q"))).ok).toBe(false); expect(h.calls).toHaveLength(0); });
  it("looks up the handle once (cached), then DMs; bearer auth; 280 cap", async () => {
    const h = rec([{ status: 200, json: { data: { id: "987654321" } } }, { status: 201, json: { data: { dm_event_id: "1" } } }, { status: 201, json: { data: { dm_event_id: "2" } } }]);
    const a = xAdapter(XT, { http: h.http, now, sleep }); t0 = 9_000_000;
    expect(await a.send(ctx("alice_q", "y".repeat(400)))).toEqual({ ok: true, status: 201 }); t0 += 20_000; expect((await a.send(ctx("@Alice_Q"))).ok).toBe(true);
    expect(h.calls.map((c) => c.url)).toEqual(["https://api.x.com/2/users/by/username/alice_q", "https://api.x.com/2/dm_conversations/with/987654321/messages", "https://api.x.com/2/dm_conversations/with/987654321/messages"]);
    expect(h.calls.every((c) => c.headers.authorization === `Bearer ${XT}`)).toBe(true); expect(JSON.parse(h.calls[1].body!).text.length).toBe(280);
  });
  it("unknown user / bad id -> final; 403 final; 429 retryable; per-recipient limit 5/min", async () => {
    let h = rec([{ status: 200, json: { errors: [{}] } }]); expect(await xAdapter(XT, { http: h.http, now, sleep }).send(ctx("@ghost_user"))).toMatchObject({ ok: false, retry: false, error: "X user not found." }); expect(h.calls).toHaveLength(1);
    h = rec([{ status: 200, json: { data: { id: "../../2/tweets" } } }]); expect((await xAdapter(XT, { http: h.http, now, sleep }).send(ctx("@sneaky_one"))).ok).toBe(false); expect(h.calls).toHaveLength(1);
    h = rec([{ status: 200, json: { data: { id: "1" } } }, { status: 403, json: {} }]); expect(await xAdapter(XT, { http: h.http, now, sleep }).send(ctx("@alice_q"))).toMatchObject({ ok: false, retry: false, status: 403 });
    h = rec([{ status: 429, json: {}, retryAfterSec: 60 }]); expect(await xAdapter(XT, { http: h.http, now, sleep }).send(ctx("@alice_q"))).toMatchObject({ ok: false, retry: true, status: 429 });
    h = rec([{ status: 200, json: { data: { id: "1" } } }, { status: 201, json: { data: {} } }]); const a = xAdapter(XT, { http: h.http, now, sleep }); t0 = 20_000_000;
    for (let i = 0; i < 5; i++) expect((await a.send(ctx("@alice_q"))).ok).toBe(true); expect(await a.send(ctx("@alice_q"))).toMatchObject({ ok: false, status: 429 });
  });
});
