// M5.9 user-supplied RPC endpoints + AI keys: encrypted at rest, never returned, SSRF-guarded RPC URLs.
import { afterEach, describe, expect, it } from "vitest";
import { UserSecretList, UserSecretView } from "../../contracts/src/secrets";
import { createApp } from "../../src/api/app";
import type { Resolver } from "../../src/alerts/ssrf";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { snapshot } from "../../src/persist";
import { SecretVault } from "../../src/secrets/vault";

const MK = "11".repeat(32); // test-only master key placeholder
const RES: Resolver = async (h) => (h === "rebind.example" ? [{ address: "10.0.0.7", family: 4 }] : [{ address: "93.184.215.14", family: 4 }]);
const AI = "sk-or-v1-testplaceholder0000abcd";
const RPC = "https://rpc.provider.example/v2/projectsecret123?token=abc";
function mk(env: Record<string, string> = { SECRETS_MASTER_KEY: MK }) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", ...env }), clock, autoTimers: false, compileDelayMs: 0, alertResolver: RES });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m59-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}` }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); return { status: r.status, t, j: (() => { try { return JSON.parse(t); } catch { return t as any; } })() };
  };
  return { q, call };
}
const real = globalThis.fetch; afterEach(() => { globalThis.fetch = real; });

describe("M5.9 user secrets", () => {
  it("vault: AES-GCM round trip, AAD-bound, wrong key fails, no plaintext in ciphertext", () => {
    const v = new SecretVault(MK); const s = v.seal(AI, "u1:ai_key:sec_1"); expect(s).toMatch(/^v1\.[0-9a-f]{12}\./); expect(s).not.toContain("testplaceholder");
    expect(v.open(s, "u1:ai_key:sec_1")).toBe(AI); expect(v.open(s, "u2:ai_key:sec_1")).toBeNull(); expect(new SecretVault("22".repeat(32)).open(s, "u1:ai_key:sec_1")).toBeNull();
    expect(new SecretVault("short").available).toBe(false); expect(new SecretVault(Buffer.alloc(32, 7).toString("base64")).available).toBe(true);
  });
  it("no master key → 503 secrets_unavailable, list says vault unavailable", async () => {
    const s = mk({}); expect((await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: AI })).j.error?.code ?? (await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: AI })).j.code).toBe("secrets_unavailable");
    expect((await s.call("a", "GET", "/me/secrets")).j).toEqual({ vault: "unavailable", items: [] });
  });
  it("save RPC + AI key: only hints come back, ever; stored encrypted; owner-scoped delete", async () => {
    const s = mk();
    const r = await s.call("a", "PUT", "/me/secrets/rpc", { chainId: 46630, url: RPC }); expect(r.status).toBe(200);
    expect(UserSecretView.parse(r.j)).toMatchObject({ kind: "rpc", chainId: 46630, hint: "https://rpc.provider.example/…", status: "ok" });
    const k = await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: AI }); expect(k.j.hint).toBe("sk-or-…abcd");
    const again = await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: AI.replace("abcd", "wxyz") }); expect(again.j.id).toBe(k.j.id); expect(again.j.hint).toBe("sk-or-…wxyz");
    const list = await s.call("a", "GET", "/me/secrets"); expect(UserSecretList.parse(list.j).items).toHaveLength(2);
    for (const t of [r.t, k.t, again.t, list.t, JSON.stringify(snapshot(s.q.store)), JSON.stringify(s.q.store.audit)]) { expect(t).not.toContain("projectsecret123"); expect(t).not.toContain("testplaceholder"); }
    expect((await s.call("b", "GET", "/me/secrets")).j.items).toEqual([]);
    expect((await s.call("b", "DELETE", `/me/secrets/${k.j.id}`)).status).toBe(404);
    expect((await s.call("a", "DELETE", `/me/secrets/${k.j.id}`)).status).toBe(204);
    expect((await s.call("a", "GET", "/me/secrets")).j.items).toHaveLength(1);
    expect((await s.call("a", "PUT", "/me/secrets/rpc", { chainId: 1, url: RPC })).status).toBe(422); // testnet only
    expect((await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: "nope" })).status).toBe(422);
  });
  it.each(["http://rpc.example/x", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest", "https://localhost/", "https://u:p@rpc.example/", "https://rpc.example:8545/", "https://rebind.example/", "https://node.internal/"])("SSRF guard blocks %s", async (url) => {
    const s = mk(); const r = await s.call("a", "PUT", "/me/secrets/rpc", { chainId: 46630, url });
    expect(r.status).toBe(422); expect(r.t).toContain("rpc_url_blocked"); expect(r.t).not.toMatch(/Webhook/);
  });
  it("a saved AI key is used for that user's compiles (even with no shared key) and is never echoed", async () => {
    const s = mk(); await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: AI }); const auth: string[] = [];
    globalThis.fetch = (async (u: any, init: any) => { if (!String(u).includes("openrouter.ai")) return real(u, init); auth.push(new Headers(init.headers).get("authorization") ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { cost: 0.001 } }), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
    const r = await s.call("a", "POST", "/compile", { thesis: "buy ETH when it drops 5% in a day" }); expect(r.status).toBe(200);
    expect(auth.length).toBeGreaterThan(0); expect(auth.every((h) => h === `Bearer ${AI}`)).toBe(true); expect(r.t).not.toContain(AI);
    expect((await s.call("a", "GET", "/me/secrets")).j.items[0].lastUsedAt).not.toBeNull();
    auth.length = 0; await s.call("b", "POST", "/compile", { thesis: "buy ETH when it drops 5% in a day" }); expect(auth).toHaveLength(0); // b has no key and there's no shared key → demo compile
  });
});
