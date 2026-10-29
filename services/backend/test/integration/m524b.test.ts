// M5.24b: low-s only. A high-s twin of a valid signature (which viem alone still accepts) is refused for wallet link + session keys.
import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { isLowS, toHighS } from "../../src/auth/lowS";
import { T0 } from "../helpers";

function setup(label: string) {
  const q = createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true", SIWE_ORIGIN: "http://localhost:3000" }), clock: new ManualClock(T0), autoTimers: false, compileDelayMs: 0 });
  let tok = "";
  const call = async (m: string, p: string, b?: unknown) => { const r = await q.app.request("/v1" + p, { method: m, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
  return { call, login: async () => { tok = (await call("POST", "/auth/exchange", { provider: "privy", idToken: label })).j.accessToken; } };
}

describe("M5.24b low-s signatures only", () => {
  it("isLowS: accepts viem signatures, rejects high-s twin, bad length, bad v", async () => {
    const w = privateKeyToAccount(generatePrivateKey()); const sig = await w.signMessage({ message: "hi" });
    expect(isLowS(sig)).toBe(true); const hi = toHighS(sig); expect(isLowS(hi)).toBe(false);
    expect(await verifyMessage({ address: w.address, message: "hi", signature: hi as any })).toBe(true); // why the guard exists
    expect(isLowS(sig.slice(0, 130))).toBe(false); expect(isLowS(sig.slice(0, 130) + "1d")).toBe(false);
  });
  it("wallet link refuses the high-s twin, accepts the canonical one", async () => {
    const s = setup("dev:m524b-link-user-label-xx"); await s.login(); const w = privateKeyToAccount(generatePrivateKey());
    const ch = (await s.call("POST", "/wallets/link/challenge", { address: w.address })).j;
    const r = await s.call("POST", "/wallets/link/verify", { nonce: ch.nonce, signature: toHighS(await w.signMessage({ message: ch.message })) });
    expect(r.status).toBe(422); expect(r.j.error.code).toBe("wallet_link_invalid");
    const ch2 = (await s.call("POST", "/wallets/link/challenge", { address: w.address })).j;
    expect((await s.call("POST", "/wallets/link/verify", { nonce: ch2.nonce, signature: await w.signMessage({ message: ch2.message }) })).status).toBe(200);
  });
  it("session-key submit refuses the high-s twin", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()); const s = setup(`dev:m524b-sk-user-label:${owner.address}`); await s.login();
    const p = (await s.call("POST", "/session-keys/prepare", { chainId: 46630, tokens: ["robinhood:token:0x00000000000000000000000000000000000000a1"], perTxCapUsd: "500", dailyCapUsd: "2000", expiresInDays: 7 })).j;
    const d = p.signatureRequest.data; const sig = await owner.signTypedData({ ...d, message: { ...d.message, expiresAt: BigInt(d.message.expiresAt) } });
    const bad = await s.call("POST", "/session-keys/submit", { sessionKeyId: p.sessionKeyId, signature: toHighS(sig), policyHash: p.policyHash });
    expect(bad.status).toBe(422); expect(bad.j.error.message).toMatch(/low-s/);
    expect((await s.call("POST", "/session-keys/submit", { sessionKeyId: p.sessionKeyId, signature: sig, policyHash: p.policyHash })).j.status).toBe("active");
  });
});
