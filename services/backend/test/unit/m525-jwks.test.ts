// M5.25: JWKS cooldown floor (10 s) + one-shot refetch for an unknown kid after the cooldown.
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as csign } from "node:crypto";
import { PrivyVerifier } from "../../src/auth/privy";
import { loadConfig } from "../../src/config";

const APP = "cm-test-app-placeholder"; const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (kid: string, now: number) => { const h = b64({ alg: "ES256", typ: "JWT", kid }); const p = b64({ iss: "privy.io", aud: APP, sub: "did:privy:abc123def456", iat: now / 1000 - 5, exp: now / 1000 + 3600 });
  return `${h}.${p}.${csign("sha256", Buffer.from(`${h}.${p}`), { key: kp.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`; };
const jwks = (kids: string[]) => ({ keys: kids.map((kid) => ({ ...kp.publicKey.export({ format: "jwk" }), kid })) as any });

describe("M5.25 JWKS", () => {
  it("default 30 s; configured values are floored at 10 s (verifier and env)", () => {
    expect(new PrivyVerifier({ appId: APP }).minInterval).toBe(30_000);
    expect(new PrivyVerifier({ appId: APP, jwksMinIntervalMs: 1 }).minInterval).toBe(10_000);
    expect(new PrivyVerifier({ appId: APP, jwksMinIntervalMs: 45_000 }).minInterval).toBe(45_000);
    expect(loadConfig({ QUIVR_MODE: "mock" }).PRIVY_JWKS_MIN_INTERVAL_MS).toBe(30_000);
    expect(loadConfig({ QUIVR_MODE: "mock", PRIVY_JWKS_MIN_INTERVAL_MS: "500" }).PRIVY_JWKS_MIN_INTERVAL_MS).toBe(10_000);
  });
  it("floor holds: a 1 ms setting still blocks refetches for 10 s", async () => {
    let now = 1_800_000_000_000; let n = 0;
    const v = new PrivyVerifier({ appId: APP, appSecret: "x", jwksMinIntervalMs: 1, now: () => now, fetchJwks: async () => { n++; return jwks(["k1"]); } });
    await v.verify(mint("k1", now)); now += 5_000; await expect(v.verify(mint("kx", now))).rejects.toThrow(/unknown key/); expect(n).toBe(1);
  });
  it("unknown kid after cooldown → exactly one refetch; still unknown → 401 with no second fetch", async () => {
    let now = 1_800_000_000_000; let kids = ["k1"]; let n = 0;
    const v = new PrivyVerifier({ appId: APP, appSecret: "x", now: () => now, fetchJwks: async () => { n++; return jwks(kids); } });
    await v.verify(mint("k1", now)); now += 30_001;
    await expect(v.verify(mint("ghost", now))).rejects.toThrow(/unknown key/); expect(n).toBe(2);
    await expect(v.verify(mint("ghost", now))).rejects.toThrow(/unknown key/); expect(n).toBe(2);
    kids = ["k1", "k2"]; now += 30_001; await v.verify(mint("k2", now)); expect(n).toBe(3); // rotated key accepted on the one-shot retry
  });
});
