// M5.13: stored user RPC URLs are used at call time (SSRF re-check + pinned connection); stored AI keys used for compile + instruct.
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AccountReadRes } from "../../contracts/src/chain";
import { createApp } from "../../src/api/app";
import type { Resolver } from "../../src/alerts/ssrf";
import { nodeRpcPost, pinnedTransport, type Pinned } from "../../src/chain/pinned";
import { ChainReader } from "../../src/chain/reader";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";

const MK = "22".repeat(32); // test-only placeholder
const RPC = "https://rpc.provider.example/v2/projsecret?token=abc";
const ADDR = "0x" + "ab".repeat(20);
const rpcAnswer = (m: string) => ({ eth_chainId: "0xb626", eth_blockNumber: "0x10", eth_getBalance: "0x5", eth_getCode: "0x" } as Record<string, unknown>)[m];

function mk() {
  let resolveTo = "93.184.215.14"; const res: Resolver = async () => [{ address: resolveTo, family: 4 }];
  const posts: { p: Pinned; method: string }[] = [];
  const rpcPost = async (p: Pinned, body: string) => { const j = JSON.parse(body); posts.push({ p, method: j.method }); return JSON.stringify({ jsonrpc: "2.0", id: j.id, result: rpcAnswer(j.method) ?? null }); };
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", SECRETS_MASTER_KEY: MK }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0, alertResolver: res, chainReader: null, rpcPost });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m513-${who}-user-label-xx` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}` }, body: b === undefined ? undefined : JSON.stringify(b) });
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* ndjson */ } return { status: r.status, j, t, h: r.headers };
  };
  return { q, call, posts, rebind: (ip: string) => { resolveTo = ip; } };
}
const real = globalThis.fetch; afterEach(() => { globalThis.fetch = real; });

describe("M5.13 per-user RPC at call time", () => {
  it("account reads go through the user's RPC, pinned to the vetted IP; other users fall back to the server (off here)", async () => {
    const s = mk(); expect((await s.call("a", "PUT", "/me/secrets/rpc", { chainId: 46630, url: RPC })).status).toBe(200);
    const r = await s.call("a", "GET", `/chain/testnet/accounts/${ADDR}`); expect(r.status).toBe(200); expect(r.h.get("x-quiver-rpc")).toBe("user");
    const a = AccountReadRes.parse(r.j); expect(a).toMatchObject({ chainId: 46630, nativeBalanceWei: "5", hasCode: false });
    expect(s.posts.length).toBeGreaterThan(0); expect(s.posts.every((x) => x.p.address === "93.184.215.14" && x.p.url.startsWith("https://rpc.provider.example/"))).toBe(true);
    expect(s.posts.map((x) => x.method)).toContain("eth_chainId");
    expect(JSON.stringify(r.j)).not.toContain("projsecret");
    expect((await s.call("a", "GET", "/me/secrets")).j.items[0].lastUsedAt).not.toBeNull();
    expect((await s.call("b", "GET", `/chain/testnet/accounts/${ADDR}`)).status).toBe(503); // b has no RPC, server reads off
  });
  it("DNS rebinding after save is refused at use time; no request is sent", async () => {
    const s = mk(); await s.call("a", "PUT", "/me/secrets/rpc", { chainId: 46630, url: RPC }); s.rebind("10.0.0.7");
    const r = await s.call("a", "GET", `/chain/testnet/accounts/${ADDR}`); expect(r.status).toBe(422); expect(r.j.error.code).toBe("rpc_url_blocked"); expect(s.posts).toHaveLength(0);
  });
  it("a user transport still fails closed on the wrong chain, bad JSON, and write methods", async () => {
    const P = { url: RPC, address: "93.184.215.14", family: 4 };
    const rd = new ChainReader({ chainId: 46630, transport: pinnedTransport(P, async (_p, b) => JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(b).id, result: "0x1" })) });
    await expect(rd.assertChain()).rejects.toThrow(/chain id mismatch/);
    await expect(pinnedTransport(P, async () => "x").request({ method: "eth_chainId" })).rejects.toThrow(/non-JSON/);
    let sent = 0; const w = new ChainReader({ chainId: 46630, transport: pinnedTransport(P, async () => { sent++; return "{}"; }) });
    await expect((w as any).client.request({ method: "eth_sendRawTransaction", params: ["0x00"] })).rejects.toThrow(); expect(sent).toBe(0);
  });
  it("nodeRpcPost connects to the pinned IP while keeping the original Host; caps size; refuses http without the test flag", async () => {
    let host = ""; const srv = http.createServer((req, res) => { host = req.headers.host ?? ""; let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      if (JSON.parse(b).method === "big") { res.end("x".repeat(1_100_000)); return; } res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xb626" })); }); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r)); const port = (srv.address() as any).port;
    try {
      const p = { url: `http://rpc.provider.example:${port}/x`, address: "127.0.0.1", family: 4 };
      expect(await pinnedTransport(p, nodeRpcPost({ insecureHttp: true })).request({ method: "eth_chainId" })).toBe("0xb626");
      expect(host).toBe(`rpc.provider.example:${port}`);
      await expect(pinnedTransport(p, nodeRpcPost({ insecureHttp: true })).request({ method: "big" })).rejects.toThrow();
      await expect(pinnedTransport(p, nodeRpcPost()).request({ method: "eth_chainId" })).rejects.toThrow(/https/);
    } finally { srv.close(); }
  });
});

describe("M5.13 stored AI key at call time", () => {
  it("instruct uses the user's key (compile already did, M5.9)", async () => {
    const s = mk(); await s.call("a", "PUT", "/me/secrets/ai", { provider: "openrouter", apiKey: "sk-or-v1-testplaceholder0000wxyz" });
    const auth: string[] = [];
    globalThis.fetch = (async (u: any, init: any) => { if (!String(u).includes("openrouter.ai")) return real(u, init); auth.push(new Headers(init.headers).get("authorization") ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { cost: 0.001 } }), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
    const seed = (await s.call("a", "GET", "/public/strategies")).j.items[0]; const f = (await s.call("a", "POST", `/public/strategies/${seed.id}/fork`)).j;
    const run = (await s.call("a", "POST", "/runs", { strategyId: f.id, mode: "paper" })).j;
    await s.call("a", "POST", `/runs/${run.id}/instruct`, { text: "make it more conservative please" });
    expect(auth.length).toBeGreaterThan(0); expect(auth.every((h) => h === "Bearer sk-or-v1-testplaceholder0000wxyz")).toBe(true);
  });
});
