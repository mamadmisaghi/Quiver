/** M3.9: session-key prepare (slippage, 64× ratio, expiry hours), signing path (policyHash, 503 signing_unavailable), landing author.
 *  The anvil part signs with anvil's own unlocked dev account through eth_signTypedData_v4 (the exact wallet RPC) and installs
 *  the returned grant calldata on a local SessionAccount. Local chain only; no real keys. Skips without Foundry. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAnvil } from "../anvil";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PrepareSessionKeyRes, SessionKey, PrepareSessionKeyReq } from "../../contracts/src/api";
import { ApiError, HTTP_STATUS } from "../../contracts/src/errors";
import { LandingRes } from "../../contracts/src/ext";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { MemStore } from "../../src/store";
import { MOCK_TARGETS, MockSigner, SessionKeyService, policyHashOf } from "../../src/sessionkeys/service";
import { MOCK_INSTRUMENTS, Registry } from "../../src/venues/registry";

const NVDA = "robinhood:token:0x00000000000000000000000000000000000000a1";
const T0 = Date.parse("2026-10-27T00:00:00Z");
const reg = new Registry(MOCK_INSTRUMENTS);
const mk = (o: Partial<{ mode: "mock" | "testnet"; signing: boolean; sa: (x: string) => string; now: () => number }> = {}) => { const store = new MemStore();
  return { store, svc: new SessionKeyService(store, reg, new MockSigner(), { mode: o.mode ?? "mock", targets: () => MOCK_TARGETS, defaults: { perTxUsd: 250, dailyUsd: 1000 }, now: o.now ?? (() => T0), signingAvailable: o.signing, smartAccountFor: o.sa }) }; };
const base = { chainId: 46630 as const, tokens: [NVDA], perTxCapUsd: "250", dailyCapUsd: "1000" };
const OWNER = "0x1111111111111111111111111111111111111111";
const code = (f: () => unknown) => { try { f(); } catch (e: any) { return e.code; } return null; };
const sign = (acct: ReturnType<typeof privateKeyToAccount>, d: any) => acct.signTypedData({ ...d, message: { ...d.message, expiresAt: BigInt(d.message.expiresAt) } });

describe("M3.9 prepare rules", () => {
  it("maxSlippagePct: optional, default 1, ≤ account cap, carried into grant bps + typed data", () => {
    const { svc, store } = mk();
    const p = svc.prepare("u", OWNER, base as any); expect(p.policy.maxSlippagePct).toBe(1); expect(p.policy.maxSlippageBps).toBe(100); expect(p.grant.maxSlippageBps).toBe(100); expect(p.signatureRequest.data.message.maxSlippageBps).toBe(100);
    expect(code(() => svc.prepare("u", OWNER, { ...base, maxSlippagePct: 1.5 } as any))).toBe("session_key_slippage_above_cap");
    store.accountSlippageCapBps.set(svc.smartAccountFor(OWNER).toLowerCase(), 1000);
    expect(svc.prepare("u", OWNER, { ...base, maxSlippagePct: 10 } as any).grant.maxSlippageBps).toBe(1000);
    expect(svc.prepare("u", OWNER, { ...base, maxSlippagePct: 0.25 } as any).grant.maxSlippageBps).toBe(25);
    expect(code(() => svc.prepare("u", OWNER, { ...base, maxSlippagePct: 0.255 } as any))).toBe("validation_failed");
    expect(PrepareSessionKeyReq.safeParse({ ...base, maxSlippagePct: 10.5 }).success).toBe(false);
    PrepareSessionKeyRes.parse(p);
  });
  it("daily ≤ 64 × per trade: 64× ok, 10/1000 → 422 session_key_cap_ratio", () => {
    const { svc } = mk();
    expect(code(() => svc.prepare("u", OWNER, { ...base, perTxCapUsd: "10", dailyCapUsd: "1000" } as any))).toBe("session_key_cap_ratio");
    expect(HTTP_STATUS.session_key_cap_ratio).toBe(422);
    const ok = svc.prepare("u", OWNER, { ...base, perTxCapUsd: "10", dailyCapUsd: "640" } as any);
    ok.grant.perTxCaps.forEach((p, i) => expect(BigInt(ok.grant.windowCaps[i])).toBeLessThanOrEqual(BigInt(p) * 64n));
  });
  it("expiry: default 24 h, max 168 h (422 session_key_expiry_too_long), expiresInDays still accepted", () => {
    const { svc } = mk();
    expect(svc.prepare("u", OWNER, base as any).policy.expiresAt).toBe("2026-10-28T00:00:00.000Z");
    expect(svc.prepare("u", OWNER, { ...base, expiresInHours: 168 } as any).grant.expiry).toBe(T0 / 1000 + 168 * 3600);
    expect(code(() => svc.prepare("u", OWNER, { ...base, expiresInHours: 169 } as any))).toBe("session_key_expiry_too_long");
    expect(code(() => svc.prepare("u", OWNER, { ...base, expiresInDays: 8 } as any))).toBe("session_key_expiry_too_long");
    expect(svc.prepare("u", OWNER, { ...base, expiresInDays: 7 } as any).grant.expiry).toBe(T0 / 1000 + 7 * 86400);
    expect(code(() => svc.prepare("u", OWNER, { ...base, expiresInDays: 1, expiresInHours: 24 } as any))).toBe("validation_failed");
  });
  it("defaults expose expiry + ratio", () => expect(mk().svc.defaults()).toMatchObject({ defaultExpiryHours: 24, maxExpiryHours: 168, maxDailyToPerTradeRatio: 64 }));
});

describe("M3.9 submit", () => {
  it("verifies signature + policyHash; tampered grant → session_key_policy_hash_mismatch", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()); const { svc, store } = mk();
    const p = svc.prepare("u", owner.address, base as any); const sig = await sign(owner, p.signatureRequest.data);
    await expect(svc.submit("u", owner.address, p.sessionKeyId, sig, "0x" + "00".repeat(32))).rejects.toMatchObject({ code: "session_key_policy_hash_mismatch" });
    store.sessionKeys.get(p.sessionKeyId)!.grant!.windowCaps = ["1"]; // server-side tamper
    await expect(svc.submit("u", owner.address, p.sessionKeyId, sig, p.policyHash)).rejects.toMatchObject({ code: "session_key_policy_hash_mismatch" });
    const p2 = svc.prepare("u", owner.address, base as any);
    expect(policyHashOf(46630, p2.smartAccount, MOCK_TARGETS, p2.grant)).toBe(p2.policyHash);
    const v = await svc.submit("u", owner.address, p2.sessionKeyId, await sign(owner, p2.signatureRequest.data), p2.policyHash);
    expect(v.status).toBe("active"); expect(v.policyHash).toBe(p2.policyHash); SessionKey.parse(v);
  });
  it("testnet without ALCHEMY_API_KEY → 503 signing_unavailable on prepare and submit", async () => {
    const { svc } = mk({ mode: "testnet", signing: false });
    expect(code(() => svc.prepare("u", OWNER, base as any))).toBe("signing_unavailable"); expect(HTTP_STATUS.signing_unavailable).toBe(503);
    await expect(svc.submit("u", OWNER, "sk_x", "0x")).rejects.toMatchObject({ code: "signing_unavailable" });
  });
  it("HTTP: testnet without key = 503 signing_unavailable; mock 10/1000 = 422 session_key_cap_ratio", async () => {
    for (const [env, body, st, c] of [[{ QUIVR_MODE: "testnet", QUIVR_JWT_SECRET: "x".repeat(40), DEV_LOGIN_ENABLED: "true" }, base, 503, "signing_unavailable"], [{ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }, { ...base, perTxCapUsd: "10" }, 422, "session_key_cap_ratio"]] as const) {
      const q = createApp({ config: loadConfig(env as any), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
      const req = async (m: string, p: string, b?: unknown, t?: string) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json() as any }; };
      const tok = (await req("POST", "/auth/exchange", { provider: "privy", idToken: "dev:m39-signing-user-01" })).json.accessToken;
      const r = await req("POST", "/session-keys/prepare", body, tok); expect(r.status).toBe(st); expect(ApiError.parse(r.json).error.code).toBe(c);
      q.runs.shutdown();
    }
  });
});

describe("M3.9 landing preview author", () => {
  it("is { handle, isYou } like featured", async () => {
    const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock" }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0 });
    const l = LandingRes.parse(await (await q.app.request("/v1/public/landing")).json());
    expect(l.preview!.author).toEqual({ handle: expect.stringMatching(/^@demo_/), isYou: false }); q.runs.shutdown();
  });
});

const BIN = join(homedir(), ".foundry/bin"); const HAS = existsSync(join(BIN, "anvil"));
const AN = HAS ? await startAnvil(46630) : null; const RPC = AN?.rpc ?? "http://127.0.0.1:1"; // M5.27: free port per file
describe.skipIf(!HAS)("M3.9 wallet flow on anvil (chain 46630, local only)", () => {
  let anvil: ChildProcess; let acct: Hex; let ownerAddr: Hex;
  const pub = createPublicClient({ transport: http(RPC), pollingInterval: 50 });
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never }) as Promise<any>;
  const art = (f: string, c: string) => JSON.parse(readFileSync(`foundry/out/${f}/${c}.json`, "utf8"));
  beforeAll(async () => {
    anvil = AN!.proc;
    ownerAddr = (await rpc("eth_accounts", []))[0]; // anvil's unlocked dev account stands in for the browser wallet
    const a = art("SessionAccount.sol", "SessionAccount"); const { encodeDeployData } = await import("viem");
    const h = await rpc("eth_sendTransaction", [{ from: ownerAddr, data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args: [ownerAddr] }) }]);
    acct = (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!;
  }, 60_000);
  afterAll(() => { anvil?.kill(); });
  it("prepare → eth_signTypedData_v4 → submit → install calls → SessionGranted with the requested bps", async () => {
    const now = Number((await pub.getBlock()).timestamp) * 1000;
    const { svc } = mk({ sa: () => acct, now: () => now }); const pa = art("SessionAccount.sol", "SessionAccount");
    const p = PrepareSessionKeyRes.parse(svc.prepare("u", ownerAddr, { ...base, perTxCapUsd: "100", dailyCapUsd: "1000", maxSlippagePct: 1, expiresInHours: 48 } as any));
    const sig = await rpc("eth_signTypedData_v4", [ownerAddr, JSON.stringify(p.signatureRequest.data)]);
    const v = await svc.submit("u", ownerAddr, p.sessionKeyId, sig, p.policyHash); expect(v.status).toBe("active");
    const call = p.install.params[0].calls[0]; expect(call.to.toLowerCase()).toBe(acct.toLowerCase()); expect(p.install.params[0].chainId).toBe("0xb626");
    const h = await rpc("eth_sendTransaction", [{ from: p.install.params[0].from, to: call.to, data: call.data, value: call.value }]); // wallet_sendCalls fallback for wallets without EIP-5792
    expect((await pub.waitForTransactionReceipt({ hash: h })).status).toBe("success");
    const s = await pub.readContract({ address: acct, abi: pa.abi, functionName: "sessions", args: [p.sessionKeyAddress] }) as any[];
    expect(Number(s[0])).toBe(p.grant.expiry); expect(Number(s[1])).toBe(100);
    const cap = await pub.readContract({ address: acct, abi: pa.abi, functionName: "tokenCaps", args: [p.sessionKeyAddress, p.grant.tokens[0]] }) as any[];
    expect(cap[0].toString()).toBe(p.grant.perTxCaps[0]); expect(cap[1].toString()).toBe(p.grant.windowCaps[0]);
  });
  it("contract rejects bps above its cap (same rule as prepare)", async () => {
    const now = Number((await pub.getBlock()).timestamp) * 1000; const s2 = mk({ sa: () => acct, now: () => now });
    s2.store.accountSlippageCapBps.set(acct.toLowerCase(), 200); // stale server view: 2%; on-chain cap is still 1%
    const p = s2.svc.prepare("u", ownerAddr, { ...base, maxSlippagePct: 2 } as any); const c = p.install.params[0].calls[0];
    const ok = await rpc("eth_sendTransaction", [{ from: ownerAddr, to: c.to, data: c.data, gas: "0x200000" }]).then((h) => pub.waitForTransactionReceipt({ hash: h }).then((r) => r.status === "success"), () => false);
    expect(ok).toBe(false);
  });
});
