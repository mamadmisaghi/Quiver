// M5.10: fixes from Robin's M5 gate (handles, unfollow, wallet link, copy loop, profile privacy, images, titles, X target, GCM tag, chain status, blockedFills, RPC re-check).
import { afterEach, describe, expect, it } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { privateKeyToAccount } from "viem/accounts";
import { CopyView, Profile } from "../../contracts/src/social";
import { WalletLinkChallengeRes } from "../../contracts/src/auth";
import { ChainStatusRes } from "../../contracts/src/chain";
import { Run } from "../../contracts/src/api";
import { createApp } from "../../src/api/app";
import type { Resolver } from "../../src/alerts/ssrf";
import { xAdapter } from "../../src/alerts/channels";
import { checkImage } from "../../src/compile/image";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { SecretVault } from "../../src/secrets/vault";

let dns: Record<string, string> = {};
const RES: Resolver = async (h) => [{ address: dns[h] ?? "93.184.215.14", family: 4 }];
function mk(env: Record<string, string> = {}) {
  const clock = new ManualClock(Date.parse("2026-10-27T15:00:00Z"));
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", SECRETS_MASTER_KEY: "11".repeat(32), SIWE_ORIGIN: "https://quiver.example", ...env }), clock, autoTimers: false, compileDelayMs: 0, alertResolver: RES, chainReader: null });
  const toks: Record<string, string> = {};
  const call = async (who: string, m: string, p: string, b?: unknown) => {
    toks[who] ??= (await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: `dev:m510-${who}-user-label` }) })).json() as any).accessToken;
    const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${toks[who]}` }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text();
    return { status: r.status, t, j: (() => { try { return JSON.parse(t); } catch { return t as any; } })() };
  };
  const userOf = (who: string) => [...q.store.users.values()].find((u) => u.label === `m510-${who}-user-label` || u.label.includes(who))!;
  return { q, call, clock, userOf };
}
const enc = encodeURIComponent;
async function anaPublishes(s: ReturnType<typeof mk>) {
  const seed = (await s.call("ana", "GET", "/public/strategies")).j.items[0];
  const mine = (await s.call("ana", "POST", `/public/strategies/${seed.id}/fork`)).j; await s.call("ana", "POST", `/strategies/${mine.id}/publish`, { public: true });
  return { mine, ana: "@m510-ana-user-label" };
}
afterEach(() => { dns = {}; });

describe("M5.10 handles + profiles", () => {
  it("a Privy DID never appears: strategies, profiles, following and replays use a keyed alias", async () => {
    const s = mk(); await s.call("pri", "GET", "/me"); const u = s.userOf("pri"); u.label = "privy:did:privy:cm0abcdefghijklmnop";
    const seed = (await s.call("pri", "GET", "/public/strategies")).j.items[0];
    const f = (await s.call("pri", "POST", `/public/strategies/${seed.id}/fork`)).j; await s.call("pri", "POST", `/strategies/${f.id}/publish`, { public: true });
    const pub = (await s.call("ben", "GET", "/public/strategies")).j.items.find((x: any) => x.id === f.id);
    expect(pub.author.handle).toMatch(/^@trader_[0-9a-f]{8}$/);
    const prof = Profile.parse((await s.call("ben", "GET", `/profiles/${enc(pub.author.handle)}`)).j); expect(prof.handle).toBe(pub.author.handle);
    expect((await s.call("pri", "GET", "/me/profile")).j.handle).toBe(pub.author.handle);
    await s.call("ben", "POST", `/profiles/${enc(pub.author.handle)}/follow`);
    const all = JSON.stringify([(await s.call("ben", "GET", "/public/strategies")).j, (await s.call("ben", "GET", "/me/following")).j, (await s.call("ben", "GET", "/traders")).j, prof]);
    expect(all).not.toContain("did:privy"); expect(all).not.toContain("privy:");
  });
  it("profiles without public strategies hide displayName, bio and following (limited); owner still sees theirs", async () => {
    const s = mk(); await s.call("cat", "PUT", "/me/profile", { displayName: "Cat Real Name", bio: "Lives in Lisbon" });
    const p = Profile.parse((await s.call("ben", "GET", `/profiles/${enc("@m510-cat-user-label")}`)).j);
    expect(p).toMatchObject({ limited: true, displayName: null, bio: null, following: null, strategies: [] });
    expect((await s.call("cat", "GET", "/me/profile")).j).toMatchObject({ limited: false, displayName: "Cat Real Name" });
    const { ana } = await anaPublishes(s); await s.call("ana", "PUT", "/me/profile", { displayName: "Ana" });
    expect((await s.call("ben", "GET", `/profiles/${enc(ana)}`)).j).toMatchObject({ limited: false, displayName: "Ana", following: 0 });
  });
});
describe("M5.10 copy-trading", () => {
  it("unfollow stops the copy run (event logged) and blocks sync for good; re-follow doesn't revive it", async () => {
    const s = mk(); const { mine, ana } = await anaPublishes(s); await s.call("ben", "POST", `/profiles/${enc(ana)}/follow`);
    const v = CopyView.parse((await s.call("ben", "POST", "/copy", { publicStrategyId: mine.id })).j); expect(v.detached).toBe(false);
    await s.call("ben", "DELETE", `/profiles/${enc(ana)}/follow`);
    const run = s.q.store.runs.get(v.runId!)!; expect(run.status).toBe("stopped");
    expect(run.events.some((e: any) => e.type === "warning" && e.code === "copy_unfollowed")).toBe(true);
    const list = (await s.call("ben", "GET", "/copy")).j.items[0]; expect(list).toMatchObject({ detached: true, runStatus: "stopped" }); expect(list.detachedAt).not.toBeNull();
    const cur = (await s.call("ana", "GET", `/strategies/${mine.id}`)).j; const st = cur.strategy ?? cur.versions?.at(-1)?.strategy;
    await s.call("ana", "PUT", `/strategies/${mine.id}`, { expectedVersion: 1, strategy: { ...st, name: "Ana v2" } });
    const sy = await s.call("ben", "POST", `/copy/${v.strategyId}/sync`); expect(sy.status).toBe(403); expect(sy.j.error?.details?.reason ?? sy.j.details?.reason).toBe("detached");
    await s.call("ben", "POST", `/profiles/${enc(ana)}/follow`); expect((await s.call("ben", "POST", `/copy/${v.strategyId}/sync`)).status).toBe(403);
    expect(s.q.store.audit.some((a) => a.action === "copy.sync_blocked")).toBe(true); expect(s.q.store.runs.get(v.runId!)!.strategyVersion).toBe(1);
  });
  it("can't copy a re-published copy of your own strategy", async () => {
    const s = mk(); const { mine, ana } = await anaPublishes(s); await s.call("ben", "POST", `/profiles/${enc(ana)}/follow`);
    const v = (await s.call("ben", "POST", "/copy", { publicStrategyId: mine.id })).j; expect((await s.call("ben", "POST", `/strategies/${v.strategyId}/publish`, { public: true })).status).toBe(200);
    await s.call("ana", "POST", `/profiles/${enc("@m510-ben-user-label")}/follow`);
    expect((await s.call("ana", "POST", "/copy", { publicStrategyId: v.strategyId })).status).toBe(422);
  });
});
describe("M5.10 wallet link", () => {
  it("EIP-4361 message (domain, URI, chain 46630, hex nonce, expiry); one account per wallet", async () => {
    const s = mk(); const acct = privateKeyToAccount(("0x" + "ab".repeat(32)) as `0x${string}`); // test-only throwaway key
    const ch = WalletLinkChallengeRes.parse((await s.call("ana", "POST", "/wallets/link/challenge", { address: acct.address.toLowerCase() })).j);
    expect(ch).toMatchObject({ domain: "quiver.example", uri: "https://quiver.example", chainId: 46630, version: "1" }); expect(ch.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(ch.message.split("\n").slice(0, 2)).toEqual(["quiver.example wants you to sign in with your Ethereum account:", acct.address]);
    for (const k of ["URI: https://quiver.example", "Version: 1", "Chain ID: 46630", `Nonce: ${ch.nonce}`, "Issued At: 2026-10-27T15:00:00.000Z", "Expiration Time: 2026-10-27T15:05:00.000Z"]) expect(ch.message).toContain(k);
    const ok = await s.call("ana", "POST", "/wallets/link/verify", { nonce: ch.nonce, signature: await acct.signMessage({ message: ch.message }) }); expect(ok.status).toBe(200);
    const b = await s.call("ben", "POST", "/wallets/link/challenge", { address: acct.address }); expect(b.status).toBe(409);
    const anaPrimary = s.userOf("ana").wallet; expect((await s.call("ben", "POST", "/wallets/link/challenge", { address: anaPrimary })).status).toBe(409);
  });
});
describe("M5.10 inputs", () => {
  const chunk = (t: string, d: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, "latin1"); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([h.subarray(4), d])) >>> 0); return Buffer.concat([h, d, c]); };
  const png = (w: number, h: number, rows = h) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(Buffer.alloc(rows * (1 + w)))), chunk("IEND", Buffer.alloc(0))]); };
  it("images: real structure required; polyglots, appended data, bad CRC, short pixel data, bombs and mismatched data-URLs rejected", () => {
    const good = png(200, 100); expect(checkImage(good.toString("base64"), "image/png").ok).toBe(true);
    expect(checkImage("data:image/png;base64," + good.toString("base64"), "image/png").ok).toBe(true);
    expect(checkImage("data:image/jpeg;base64," + good.toString("base64"), "image/png")).toMatchObject({ reason: "type_mismatch" });
    expect(checkImage(Buffer.concat([good, Buffer.from("<?php system($_GET[1]); ?>PK\x03\x04")]).toString("base64"), "image/png")).toMatchObject({ reason: "corrupt" });
    const bad = Buffer.from(good); bad[bad.length - 20] ^= 0xff; expect(checkImage(bad.toString("base64"), "image/png")).toMatchObject({ ok: false });
    expect(checkImage(png(200, 100, 50).toString("base64"), "image/png")).toMatchObject({ reason: "corrupt" });
    expect(checkImage(png(4096, 4096, 1).toString("base64"), "image/png")).toMatchObject({ reason: "bad_dimensions" });
    const jpg = (tail: number[]) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 100, 0, 100, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0xff, 0xd9, ...tail]).toString("base64");
    expect(checkImage(jpg([]), "image/jpeg").ok).toBe(true); expect(checkImage(jpg([0x50, 0x4b, 3, 4]), "image/jpeg")).toMatchObject({ reason: "corrupt" });
  });
  it("replay titles are plain text: no bidi/zero-width/control chars or <>, max 80", async () => {
    const s = mk(); const st = (await s.call("ana", "GET", "/public/strategies")).j.items[0]; const f = (await s.call("ana", "POST", `/public/strategies/${st.id}/fork`)).j;
    const run = (await s.call("ana", "POST", "/runs", { strategyId: f.id, mode: "paper" })).j; await s.q.runs.tick(run.id); s.clock.advance(120_000); await s.q.runs.tick(run.id);
    const r = await s.call("ana", "POST", `/runs/${run.id}/replay/share`, { title: "<script>x</script>\u202Egnp.exe\u200B  ok" , frameMs: 60000 }); expect(r.status).toBe(201);
    expect(r.j.title).toBe("scriptx/script gnp.exe ok"); expect((await s.call("ana", "POST", `/runs/${run.id}/replay/share`, { title: "\u200B\u202E", frameMs: 60000 })).j.title).toMatch(/replay$/);
  });
  it("X targets follow X handle rules; GCM tag pinned to 16 bytes", () => {
    const x = xAdapter(); expect(x.normalizeTarget("alice_q")).toBe("@alice_q");
    for (const t of ["@ab", "@" + "a".repeat(16), "@TwitterSupport", "@siteadmin", "@12345", "@a-b", "@a b"]) expect(x.normalizeTarget(t)).toBeNull();
    const v = new SecretVault("11".repeat(32)); const sealed = v.seal("hello", "a"); const [p, k, b] = sealed.split("."); const raw = Buffer.from(b!, "base64url");
    const short = Buffer.concat([raw.subarray(0, 12), raw.subarray(12, 24)]); // 12-byte tag, no ciphertext
    expect(v.open(`${p}.${k}.${short.toString("base64url")}`, "a")).toBeNull(); expect(v.open(sealed, "a")).toBe("hello");
  });
});
describe("M5.10 chain + runs + RPC", () => {
  it("chain status with reads off: 200 with enabled:false; accounts route stays 503", async () => {
    const s = mk(); const st = ChainStatusRes.parse((await s.call("ana", "GET", "/chain/testnet/status")).j);
    expect(st).toMatchObject({ enabled: false, reachable: false, chainIdMatches: null, blockNumber: null, tradable: false });
    expect((await s.call("ana", "GET", "/chain/testnet/accounts/0x" + "11".repeat(20))).status).toBe(503);
  });
  it("runs expose blockedFills", async () => {
    const s = mk(); const st = (await s.call("ana", "GET", "/public/strategies")).j.items[0]; const f = (await s.call("ana", "POST", `/public/strategies/${st.id}/fork`)).j;
    const run = (await s.call("ana", "POST", "/runs", { strategyId: f.id, mode: "paper" })).j; expect(Run.parse((await s.call("ana", "GET", `/runs/${run.id}`)).j).blockedFills).toBe(0);
    s.q.runs.live.get(run.id)!.ex.blockedFills = 2; expect((await s.call("ana", "GET", `/runs/${run.id}`)).j.blockedFills).toBe(2);
  });
  it("a stored RPC URL is re-checked at use time (DNS rebinding → blocked) and returns the pinned address", async () => {
    const s = mk(); expect((await s.call("ana", "PUT", "/me/secrets/rpc", { chainId: 46630, url: "https://rpc.flip.example/v1" })).status).toBe(200);
    const uid = s.userOf("ana").id; expect(await s.q.secrets.userRpcFor(uid, 46630)).toEqual({ url: "https://rpc.flip.example/v1", address: "93.184.215.14", family: 4 });
    dns["rpc.flip.example"] = "169.254.169.254"; await expect(s.q.secrets.userRpcFor(uid, 46630)).rejects.toMatchObject({ code: "rpc_url_blocked" });
    expect(await s.q.secrets.userRpcFor("usr_nobody", 46630)).toBeNull();
  });
});
