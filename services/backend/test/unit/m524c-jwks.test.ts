// M5.24c: JWKS refetch cooldown (min interval) + single-flight. Test keys are generated in memory (P-256, verification only).
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as csign } from "node:crypto";
import { PrivyVerifier } from "../../src/auth/privy";

const APP = "cm-test-app-placeholder"; const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (kid: string, now: number) => { const h = b64({ alg: "ES256", typ: "JWT", kid }); const p = b64({ iss: "privy.io", aud: APP, sub: "did:privy:abc123def456", iat: now / 1000 - 5, exp: now / 1000 + 3600 });
  return `${h}.${p}.${csign("sha256", Buffer.from(`${h}.${p}`), { key: kp.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`; };
const jwks = (kids: string[]) => ({ keys: kids.map((kid) => ({ ...kp.publicKey.export({ format: "jwk" }), kid })) as any });

describe("M5.24c JWKS cooldown + single-flight", () => {
  it("unknown kids can't force a refetch inside the cooldown; allowed after it", async () => {
    let now = 1_800_000_000_000; let kids = ["k1"]; let n = 0;
    const v = new PrivyVerifier({ appId: APP, appSecret: "x", now: () => now, fetchJwks: async () => { n++; return jwks(kids); } });
    await v.verify(mint("k1", now)); expect(n).toBe(1);
    for (let i = 0; i < 20; i++) await expect(v.verify(mint("rogue" + i, now))).rejects.toThrow(/unknown key/);
    expect(n).toBe(1);
    kids = ["k1", "k2"]; now += 30_001;
    await v.verify(mint("k2", now)); expect(n).toBe(2); // rotation picked up after the interval
  });
  it("concurrent misses share one in-flight fetch", async () => {
    let n = 0; let release!: () => void; const gate = new Promise<void>((r) => (release = r)); const now = 1_800_000_000_000;
    const v = new PrivyVerifier({ appId: APP, appSecret: "x", now: () => now, fetchJwks: async () => { n++; await gate; return jwks(["k1"]); } });
    const all = Promise.all(Array.from({ length: 10 }, () => v.verify(mint("k1", now)))); release();
    expect((await all).length).toBe(10); expect(n).toBe(1);
  });
  it("a failed fetch is not retried inside the cooldown (503, no hammering)", async () => {
    let now = 1_800_000_000_000; let n = 0; let down = true;
    const v = new PrivyVerifier({ appId: APP, appSecret: "x", now: () => now, fetchJwks: async () => { n++; if (down) throw new Error("down"); return jwks(["k1"]); } });
    for (let i = 0; i < 5; i++) await expect(v.verify(mint("k1", now))).rejects.toThrow(/unreachable/);
    expect(n).toBe(1); down = false; now += 30_001; await v.verify(mint("k1", now)); expect(n).toBe(2);
  });
});
