// M4.0 alerts: webhook provider (HMAC, SSRF), stubs, retry queue, run-event hook.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AlertDelivery, AlertDeliveryList, AlertRule, AlertSettings, AlertWebhookPayload, PutAlertSettingsRes } from "../../contracts/src/alerts";
import { ApiError } from "../../contracts/src/errors";
import { createApp } from "../../src/api/app";
import type { Transport } from "../../src/alerts/service";
import { checkUrlShape, isBlockedIp, resolvePublic, type Resolver } from "../../src/alerts/ssrf";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

const PUBLIC: Resolver = async (h) => (h === "evil.example" ? [{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }] : h === "meta.example" ? [{ address: "169.254.169.254", family: 4 }] : [{ address: "93.184.215.14", family: 4 }]);
function mk(provider = "webhook", statuses: number[] = [200]) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z")); const sent: { u: URL; pinned: string; h: Record<string, string>; body: string }[] = [];
  const transport: Transport = async (u, p, h, body) => { sent.push({ u, pinned: p.address, h, body }); const s = statuses.length > 1 ? statuses.shift()! : statuses[0]; if (s < 0) throw new Error("ECONNRESET"); return s; };
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ALERTS_PROVIDER: provider }), clock, autoTimers: false, compileDelayMs: 0, alertResolver: PUBLIC, alertTransport: transport });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: r.status === 204 ? null : await r.json() as any }; };
  const login = async (who = "alice-user-m40-test") => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: `dev:${who}` })).j.accessToken; };
  return { q, clock, sent, call, login };
}

describe("M4.0 SSRF guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "ff02::1"])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["93.184.215.14", "1.1.1.1", "2606:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
  it.each(["http://example.com/h", "https://user:pw@example.com/", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://example.com:22/", "https://metadata.internal/", "ftp://x.com"])("rejects shape %s", (u) => expect(() => checkUrlShape(u)).toThrow());
  it("rejects when any resolved address is private (DNS)", async () => {
    await expect(resolvePublic(new URL("https://evil.example/h"), PUBLIC)).rejects.toThrow(/private/);
    await expect(resolvePublic(new URL("https://meta.example/h"), PUBLIC)).rejects.toThrow(/private/);
    expect((await resolvePublic(new URL("https://hooks.example/h"), PUBLIC)).address).toBe("93.184.215.14");
  });
});

describe("M4.0 alerts API", () => {
  it("settings: per-user URL, secret shown once, blocked URLs → 422 alert_url_blocked", async () => {
    const t = mk(); await t.login();
    expect(AlertSettings.parse((await t.call("GET", "/alerts/settings")).j)).toEqual({ provider: "webhook", providerStatus: "ok", webhookUrl: null, signingSecretSet: false });
    const bad = await t.call("PUT", "/alerts/settings", { webhookUrl: "https://evil.example/h" }); expect(bad.status).toBe(422); expect(ApiError.parse(bad.j).error.code).toBe("alert_url_blocked");
    expect((await t.call("PUT", "/alerts/settings", { webhookUrl: "http://hooks.example/h" })).j.error.code).toBe("alert_url_blocked");
    const ok = PutAlertSettingsRes.parse((await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a" })).j); expect(ok.signingSecret).toMatch(/^whsec_/);
    const again = PutAlertSettingsRes.parse((await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/b" })).j); expect(again.signingSecret).toBeNull();
    const rot = PutAlertSettingsRes.parse((await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/b", rotateSecret: true })).j); expect(rot.signingSecret).not.toBe(ok.signingSecret);
    await t.login("bob-user-m40-testxx"); expect((await t.call("GET", "/alerts/settings")).j.webhookUrl).toBeNull(); // per user
  });

  it("test alert: HMAC-signed body, pinned address, verifiable by the receiver", async () => {
    const t = mk(); await t.login();
    const { signingSecret } = (await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a?x=1" })).j;
    const r = await t.call("POST", "/alerts/test"); expect(r.status).toBe(202); expect(AlertDelivery.parse(r.j).status).toBe("delivered");
    const s = t.sent[0]; expect(s.pinned).toBe("93.184.215.14"); expect(s.u.href).toBe("https://hooks.example/a?x=1");
    const expected = "v1=" + createHmac("sha256", signingSecret).update(`${s.h["x-quiver-timestamp"]}.${s.body}`).digest("hex");
    expect(s.h["x-quiver-signature"]).toBe(expected); expect(Number(s.h["x-quiver-timestamp"])).toBe(Date.parse("2026-10-27T15:00:00Z") / 1000);
    const p = AlertWebhookPayload.parse(JSON.parse(s.body)); expect(p.kind).toBe("test"); expect(p.deliveryId).toBe(s.h["x-quiver-delivery"]);
  });

  it("retry queue: 5xx/network retried with backoff, 4xx final, max 5 attempts", async () => {
    const t = mk("webhook", [503, -1, 200]); await t.login(); await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a" });
    let d = (await t.call("POST", "/alerts/test")).j; expect(d.status).toBe("queued"); expect(d.attempts).toBe(1); expect(d.lastStatusCode).toBe(503);
    await t.q.alerts.process(); expect(t.sent.length).toBe(1); // not due yet
    t.clock.advance(10_000); await t.q.alerts.process(); expect(t.q.alerts.deliveries.get(d.id)!.attempts).toBe(2); expect(t.q.alerts.deliveries.get(d.id)!.lastError).toMatch(/ECONNRESET/);
    t.clock.advance(60_000); await t.q.alerts.process(); d = AlertDeliveryList.parse((await t.call("GET", "/alerts/deliveries")).j).items[0]; expect(d.status).toBe("delivered"); expect(d.attempts).toBe(3);
    const f = mk("webhook", [404]); await f.login(); await f.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a" });
    expect((await f.call("POST", "/alerts/test")).j).toMatchObject({ status: "failed", attempts: 1, lastStatusCode: 404 });
    const g = mk("webhook", [500]); await g.login(); await g.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a" });
    const id = (await g.call("POST", "/alerts/test")).j.id; for (const s of [10, 60, 300, 1800]) { g.clock.advance(s * 1000); await g.q.alerts.process(); }
    expect(g.q.alerts.deliveries.get(id)).toMatchObject({ status: "failed", attempts: 5 }); g.clock.advance(86_400_000); await g.q.alerts.process(); expect(g.sent.length).toBe(5);
  });

  it("email/telegram stubs → not_configured, never retried", async () => {
    for (const p of ["email", "telegram"]) {
      const t = mk(p); await t.login(); expect((await t.call("GET", "/alerts/settings")).j).toMatchObject({ provider: p, providerStatus: "not_configured" });
      expect((await t.call("POST", "/alerts/test")).j).toMatchObject({ provider: p, status: "not_configured", nextAttemptAt: null }); expect(t.sent.length).toBe(0);
    }
  });

  it("rules hook into run events (fill/status), scoped to owner and run", async () => {
    const t = mk(); await t.login(); await t.call("PUT", "/alerts/settings", { webhookUrl: "https://hooks.example/a" });
    const pubs = (await t.call("GET", "/public/strategies")).j; const fork = (await t.call("POST", `/public/strategies/${pubs.items[0].id}/fork`)).j;
    const run = (await t.call("POST", "/runs", { strategyId: fork.id, mode: "paper", startingEquityUsd: "10000" })).j;
    expect((await t.call("POST", "/alerts/rules", { events: [] })).status).toBe(422);
    expect((await t.call("POST", "/alerts/rules", { runId: "run_00000000000000000000", events: ["fill"] })).status).toBe(404);
    const rule = AlertRule.parse((await t.call("POST", "/alerts/rules", { runId: run.id, events: ["status", "fill"] })).j);
    await t.login("bob-user-m40-testxx"); await t.call("POST", "/alerts/rules", { events: ["status"] }); await t.login(); // bob's rule must not see alice's run
    for (let i = 0; i < 30; i++) { t.clock.advance(60_000); await t.q.runs.tick(run.id); }
    await t.login(); expect((await t.call("POST", `/runs/${run.id}/control`, { action: "stop" })).status).toBe(200);
    await t.q.alerts.process();
    const ds = [...t.q.alerts.deliveries.values()]; expect(ds.length).toBeGreaterThan(0); expect(ds.every((d) => d.ruleId === rule.id && d.runId === run.id)).toBe(true);
    for (const s of t.sent) { const p = AlertWebhookPayload.parse(JSON.parse(s.body)); expect(["status", "fill"]).toContain(p.event!.type); }
    expect((await t.call("GET", "/alerts/rules")).j.items).toHaveLength(1);
    expect((await t.call("DELETE", `/alerts/rules/${rule.id}`)).status).toBe(204); expect((await t.call("DELETE", `/alerts/rules/${rule.id}`)).status).toBe(404);
  });
});
