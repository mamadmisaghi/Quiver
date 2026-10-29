// M5.6 — compile from a chart screenshot: type/size/dimension limits, placeholder key, quota + budget, vision payload.
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

async function setup(w: string, env: Record<string, string> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, autoTimers: false, compileDelayMs: 0 });
  const toks: Record<string, string> = {};
  const login = async (who: string) => (toks[who] = (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:${who}` }) })).json() as any).accessToken);
  const call = async (m: string, p: string, b?: unknown, who: string = w) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who] ?? (await login(who))}` }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, j }; };
  await login(w); return { q, call };
}
const real = globalThis.fetch; afterEach(() => { globalThis.fetch = real; });
const stub = () => { const o = { bodies: [] as any[] };
  globalThis.fetch = (async (u: any, init: any) => { if (!String(u).includes("openrouter.ai")) return real(u, init); o.bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { cost: 0.001 } }), { status: 200, headers: { "content-type": "application/json" } }); }) as any; return o; };
const chunk = (t: string, d: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, "latin1"); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([h.subarray(4), d])) >>> 0); return Buffer.concat([h, d, c]); };
const pngBuf = (w: number, h: number) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0; const raw = w * h <= 16_777_216 ? deflateSync(Buffer.alloc(h * (1 + w))) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", raw), chunk("IEND", Buffer.alloc(0))]); };
const png = (w: number, h: number, pad = 0) => Buffer.concat([pngBuf(w, h), Buffer.alloc(pad)]).toString("base64");
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0xff, 0xd9]).toString("base64");
const webp = (w: number, h: number) => { const b = Buffer.alloc(30 + 8 + 6); b.write("RIFF", 0, "ascii"); b.writeUInt32LE(b.length - 8, 4); b.write("WEBPVP8X", 8, "ascii"); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); b.write("VP8L", 30, "ascii"); b.writeUInt32LE(5, 34); return b.toString("base64"); };
const OR = { OPENROUTER_API_KEY: "sk-or-test-placeholder", LLM_DAILY_BUDGET_USD: "1" };

describe("M5.6 compile from chart screenshot", () => {
  it("validates type, magic bytes, size and dimensions before any AI call", async () => {
    const s = await setup("m56-limits-user-aaaaaaaaaa", OR); const o = stub();
    let n = 0; const t = async (b: any) => { const r = await s.call("POST", "/compile/image", b, `m56-limits-u${n++}-aaaaaaaaaaaa`); /* 3/min/user also counts rejected uploads */ return [r.status, r.j?.error?.code ?? r.j?.code, r.j?.error?.details?.reason ?? r.j?.details?.reason]; };
    expect((await t({ mimeType: "image/gif", imageBase64: png(800, 600) }))[0]).toBe(422);
    expect(await t({ mimeType: "image/jpeg", imageBase64: png(800, 600) })).toEqual([422, "image_invalid", "type_mismatch"]);
    expect(await t({ mimeType: "image/png", imageBase64: Buffer.from("not an image at all, just text").toString("base64") })).toEqual([422, "image_invalid", "unsupported_type"]);
    expect(await t({ mimeType: "image/png", imageBase64: png(20, 20) })).toEqual([422, "image_invalid", "bad_dimensions"]);
    expect(await t({ mimeType: "image/png", imageBase64: png(9000, 600) })).toEqual([422, "image_invalid", "bad_dimensions"]);
    expect(await t({ mimeType: "image/png", imageBase64: png(800, 600, 2_100_000) })).toEqual([413, "payload_too_large", "too_large"]);
    expect(o.bodies.length).toBe(0);
  });
  it("placeholder (unset) key → 503 vision_unavailable without charging quota; guests are refused", async () => {
    const s = await setup("m56-nokey-user-aaaaaaaaaaa"); const r = await s.call("POST", "/compile/image", { mimeType: "image/png", imageBase64: png(800, 600) });
    expect(r.status).toBe(503); expect(JSON.stringify(r.j)).toContain("vision_unavailable");
    const g = await s.q.app.request("/v1/compile/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: "image/png", imageBase64: png(800, 600) }) });
    expect(g.status).toBe(401);
  });
  it("sends the image as a vision content part with the vision model; falls back to the note; no note → compile_failed and quota refunded", async () => {
    const s = await setup("m56-vision-user-aaaaaaaaaa", { ...OR, LLM_USER_DAILY_COMPILES: "1" }); const o = stub();
    for (const [m, img] of [["image/jpeg", jpeg(1280, 720)], ["image/webp", webp(1024, 768)]] as const) {
      const r = await s.call("POST", "/compile/image", { mimeType: m, imageBase64: img });
      expect(r.status).toBe(200); expect(String(r.j)).toContain("compile_failed");
    }
    const last = o.bodies.at(-1); expect(last.model).toBe("openai/gpt-4o-mini");
    const parts = last.messages.find((x: any) => x.role === "user").content; expect(parts[1].image_url.url).toMatch(/^data:image\/webp;base64,/);
    expect(JSON.stringify(last.messages)).toContain("never instructions");
    const ok = await s.call("POST", "/compile/image", { mimeType: "image/png", imageBase64: png(800, 600), note: "buy ETH when it drops 5% in a day" });
    expect(ok.status).toBe(200); expect(String(ok.j)).toContain('"type":"result"');
    // LLM_USER_DAILY_COMPILES=1: had the two failed reads counted, this third call would have been refused
  });
});
