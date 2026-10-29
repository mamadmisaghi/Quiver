// M5.2 — Privy identity-token verification (fail closed) + wallet-link scaffold (personal_sign, single-use nonce).
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as csign } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { PrivyVerifier } from "../../src/auth/privy";
import { AuthConfigRes, LinkedWalletsRes, WalletLinkChallengeRes } from "../../contracts/src/auth";

const NOW = Date.parse("2026-10-27T15:00:00Z"); const APP = "cm-test-app-placeholder";
const kp = generateKeyPairSync("ec", { namedCurve: "P-256" }); const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...kp.publicKey.export({ format: "jwk" }), kid: "k1" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (claims: Record<string, unknown> = {}, o: { key?: typeof kp.privateKey; alg?: string; kid?: string } = {}) => {
  const h = b64({ alg: o.alg ?? "ES256", typ: "JWT", kid: o.kid ?? "k1" });
  const p = b64({ iss: "privy.io", aud: APP, sub: "did:privy:abc123def456", iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, linked_accounts: JSON.stringify([{ type: "wallet", address: "0x1111111111111111111111111111111111111111", chain_type: "ethereum" }, { type: "email", address: "a@example.invalid" }]), ...claims });
  const sig = csign("sha256", Buffer.from(`${h}.${p}`), { key: o.key ?? kp.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${sig}`;
};

function setup(env: Record<string, string> = {}, privy?: PrivyVerifier) {
  const clock = new ManualClock(NOW);
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", SIWE_ORIGIN: "http://localhost:3000", ...env }), clock, autoTimers: false, compileDelayMs: 0, privy });
  const req = async (m: string, p: string, b?: unknown, tok?: string) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: (await r.json().catch(() => null)) as any }; };
  return { q, req, clock };
}
const verifier = (fetches = { n: 0 }) => new PrivyVerifier({ appId: APP, appSecret: "placeholder-secret", now: () => NOW, fetchJwks: async () => { fetches.n++; return { keys: [jwk as any] }; } });

describe("M5.2 Privy sign-in", () => {
  it("unset PRIVY_* → fails closed: 503 auth_unavailable, config says disabled", async () => {
    const s = setup();
    expect((await s.req("POST", "/auth/exchange", { provider: "privy", idToken: mint() })).j.error.code).toBe("auth_unavailable");
    const c = AuthConfigRes.parse((await s.req("GET", "/auth/config")).j); expect(c.privy).toEqual({ enabled: false, appId: null });
  });
  it("valid token → session; same sub → same user; wallet from linked_accounts; JWKS cached", async () => {
    const f = { n: 0 }; const s = setup({}, verifier(f));
    const a = await s.req("POST", "/auth/exchange", { provider: "privy", idToken: mint() }); expect(a.status).toBe(200);
    expect(a.j.me.wallets[0].address).toBe("0x1111111111111111111111111111111111111111");
    const b = await s.req("POST", "/auth/exchange", { provider: "privy", idToken: mint() }); expect(b.j.me.id).toBe(a.j.me.id); expect(f.n).toBe(1);
    expect(LinkedWalletsRes.parse((await s.req("GET", "/me/wallets", undefined, a.j.accessToken)).j).items).toEqual([{ address: "0x1111111111111111111111111111111111111111", linkedAt: new Date(NOW).toISOString(), primary: true }]);
    expect(AuthConfigRes.parse((await s.req("GET", "/auth/config")).j).privy).toEqual({ enabled: true, appId: APP });
  });
  it.each([
    ["wrong key", () => mint({}, { key: other.privateKey })], ["alg none", () => mint({}, { alg: "none" })], ["HS256", () => mint({}, { alg: "HS256" })],
    ["unknown kid", () => mint({}, { kid: "k9" })], ["wrong aud", () => mint({ aud: "other-app" })], ["wrong iss", () => mint({ iss: "evil.io" })],
    ["expired", () => mint({ exp: NOW / 1000 - 120 })], ["future iat", () => mint({ iat: NOW / 1000 + 600 })], ["bad sub", () => mint({ sub: "user-1" })],
    ["tampered payload", () => { const [h, , sg] = mint().split("."); return `${h}.${b64({ iss: "privy.io", aud: APP, sub: "did:privy:attacker000", exp: NOW / 1000 + 3600 })}.${sg}`; }],
    ["garbage", () => "x".repeat(40)],
  ])("rejects %s with 401", async (_n, tok) => {
    const s = setup({}, verifier()); const r = await s.req("POST", "/auth/exchange", { provider: "privy", idToken: tok() });
    expect(r.status).toBe(401); expect(r.j.error.code).toBe("unauthorized");
  });
  it("JWKS unreachable → 503; dev tokens refused when dev login is off", async () => {
    const s = setup({}, new PrivyVerifier({ appId: APP, appSecret: "x", now: () => NOW, fetchJwks: async () => { throw new Error("down"); } }));
    expect((await s.req("POST", "/auth/exchange", { provider: "privy", idToken: mint() })).status).toBe(503);
    expect((await setup({}, verifier()).req("POST", "/auth/exchange", { provider: "privy", idToken: "dev:someone-long-enough-label" })).status).toBe(401);
  });
});

describe("M5.2 wallet link", () => {
  const login = async (s: ReturnType<typeof setup>) => (await s.req("POST", "/auth/exchange", { provider: "privy", idToken: "dev:m52-wallet-user-aaaaaaaa" })).j.accessToken as string;
  it("challenge → personal_sign → linked; nonce single-use; wrong signer and expiry refused; unlink", async () => {
    const s = setup({ DEV_LOGIN_ENABLED: "true" }); const tok = await login(s); const w = privateKeyToAccount(generatePrivateKey()); const evil = privateKeyToAccount(generatePrivateKey());
    const ch = WalletLinkChallengeRes.parse((await s.req("POST", "/wallets/link/challenge", { address: w.address }, tok)).j);
    expect(ch.message).toContain(w.address); expect(ch.message).toContain("does not move funds");
    const bad = await s.req("POST", "/wallets/link/verify", { nonce: ch.nonce, signature: await evil.signMessage({ message: ch.message }) }, tok);
    expect(bad.j.error.code).toBe("wallet_link_invalid");
    expect((await s.req("POST", "/wallets/link/verify", { nonce: ch.nonce, signature: await w.signMessage({ message: ch.message }) }, tok)).status).toBe(422); // burned
    const ch2 = (await s.req("POST", "/wallets/link/challenge", { address: w.address }, tok)).j;
    const ok = await s.req("POST", "/wallets/link/verify", { nonce: ch2.nonce, signature: await w.signMessage({ message: ch2.message }) }, tok);
    expect(ok.status).toBe(200); expect(LinkedWalletsRes.parse(ok.j).items.map((x) => x.address)).toEqual([w.address]);
    const ch3 = (await s.req("POST", "/wallets/link/challenge", { address: evil.address }, tok)).j; s.clock.advance(5 * 60_000 + 1);
    expect((await s.req("POST", "/wallets/link/verify", { nonce: ch3.nonce, signature: await evil.signMessage({ message: ch3.message }) }, tok)).status).toBe(422);
    expect((await s.req("DELETE", `/me/wallets/${w.address}`, undefined, tok)).j.items).toEqual([]);
    expect((await s.req("DELETE", `/me/wallets/${w.address}`, undefined, tok)).status).toBe(404);
    expect((await s.req("GET", "/me/wallets")).status).toBe(401);
  });
  it("another user's nonce is refused", async () => {
    const s = setup({ DEV_LOGIN_ENABLED: "true" }); const t1 = await login(s);
    const t2 = (await s.req("POST", "/auth/exchange", { provider: "privy", idToken: "dev:m52-wallet-user-bbbbbbbb" })).j.accessToken;
    const w = privateKeyToAccount(generatePrivateKey()); const ch = (await s.req("POST", "/wallets/link/challenge", { address: w.address }, t1)).j;
    expect((await s.req("POST", "/wallets/link/verify", { nonce: ch.nonce, signature: await w.signMessage({ message: ch.message }) }, t2)).status).toBe(422);
  });
});
