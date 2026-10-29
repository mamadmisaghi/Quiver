// M5.8 Telegram / X alert adapters (stubs) alongside the webhook, which must keep working.
import { describe, expect, it } from "vitest";
import { AlertChannel, AlertChannelList, AlertDeliveryList } from "../../contracts/src/alerts";
import { telegramAdapter, xAdapter } from "../../src/alerts/channels";
import { createApp } from "../../src/api/app";
import type { Transport } from "../../src/alerts/service";
import type { Resolver } from "../../src/alerts/ssrf";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

const PUBLIC: Resolver = async (h) => (h === "evil.example" ? [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }] : h === "meta.example" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "93.184.215.14", family: 4 }]);
function mk(provider = "webhook", statuses: number[] = [200], env: Record<string, string> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z")); const sent: { u: URL; pinned: string; h: Record<string, string>; body: string }[] = [];
  const transport: Transport = async (u, p, h, body) => { sent.push({ u, pinned: p.address, h, body }); const s = statuses.length > 1 ? statuses.shift()! : statuses[0]; if (s < 0) throw new Error("ECONNRESET"); return s; };
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ALERTS_PROVIDER: provider, ...env }), clock, autoTimers: false, compileDelayMs: 0, alertResolver: PUBLIC, alertTransport: transport,
    channelHttp: async (r) => (r.url.includes("/users/by/username/") ? { status: 200, json: { data: { id: "12345" } } } : { status: 201, json: { data: { dm_event_id: "1" } } }) });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: r.status === 204 ? null : await r.json() as any }; };
  const login = async (who = "alice-user-m40-test") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}` })).j.accessToken; };
  return { q, clock, sent, call, login };
}


describe("M5.8 chat alert channels", () => {
  it("adapters normalize targets and render within platform limits", () => {
    const t = telegramAdapter(), x = xAdapter("placeholder");
    expect(t.status).toBe("not_configured"); expect(x.status).toBe("ok");
    expect(t.normalizeTarget(" 123456789 ")).toBe("123456789"); expect(t.normalizeTarget("-1001234567890")).toBe("-1001234567890"); expect(t.normalizeTarget("@my_alerts")).toBe("@my_alerts"); expect(t.normalizeTarget("https://t.me/x")).toBeNull();
    expect(x.normalizeTarget("alice_01")).toBe("@alice_01"); expect(x.normalizeTarget("@way_too_long_handle_x")).toBeNull();
    expect(x.render("a\u0007".repeat(400), null).length).toBe(280); expect(t.render("hi", "run_x")).toBe("Quiver alert\nhi\nRun run_x");
  });
  it("set channels; a run event fans out to webhook (delivered, signed) + telegram/x (not_configured stubs); test alert too", async () => {
    const s = mk("webhook", [200], { X_ALERTS_TOKEN: "placeholder" }); await s.login();
    expect(AlertChannelList.parse((await s.call("GET", "/alerts/channels")).j).items.map((c) => [c.name, c.status, c.target])).toEqual([["telegram", "not_configured", null], ["x", "ok", null]]);
    expect((await s.call("PUT", "/alerts/channels/telegram", { target: "not a chat" })).status).toBe(422);
    expect((await s.call("PUT", "/alerts/channels/email", { target: "a@b.co" })).status).toBe(404);
    expect(AlertChannel.parse((await s.call("PUT", "/alerts/channels/telegram", { target: "123456789" })).j).target).toBe("123456789");
    expect((await s.call("PUT", "/alerts/channels/x", { target: "alice" })).j.target).toBe("@alice");
    expect((await s.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/q" })).status).toBe(200);
    const t = await s.call("POST", "/alerts/test"); expect(t.status).toBe(202); expect(t.j).toMatchObject({ provider: "webhook", status: "delivered" });
    expect(s.sent).toHaveLength(1); expect(s.sent[0].h["x-quiver-signature"]).toMatch(/^v1=/);
    const ds = AlertDeliveryList.parse((await s.call("GET", "/alerts/deliveries")).j).items;
    const by = Object.fromEntries(ds.map((d) => [d.provider, d])); expect(by.webhook.status).toBe("delivered");
    expect(by.telegram).toMatchObject({ status: "not_configured", lastError: "Telegram alerts are not configured yet." }); expect(by.x).toMatchObject({ status: "delivered" }); // M5.14: real sender (mocked HTTP here)
    expect((await s.call("PUT", "/alerts/channels/x", { target: null })).j.target).toBeNull();
    await s.call("POST", "/alerts/test"); expect((await s.call("GET", "/alerts/deliveries")).j.items.filter((d: any) => d.provider === "x")).toHaveLength(1); expect(s.sent).toHaveLength(2);
  });
  it("ALERTS_PROVIDER=telegram makes the telegram stub primary (no double delivery)", async () => {
    const s = mk("telegram"); await s.login(); await s.call("PUT", "/alerts/channels/telegram", { target: "123456789" });
    expect((await s.call("GET", "/alerts/channels")).j.items[0].primary).toBe(true);
    const t = await s.call("POST", "/alerts/test"); expect(t.j).toMatchObject({ provider: "telegram", status: "not_configured" });
    expect((await s.call("GET", "/alerts/deliveries")).j.items).toHaveLength(1); expect(s.sent).toHaveLength(0);
  });
});
