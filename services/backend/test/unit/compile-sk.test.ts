import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { compile } from "../../src/compile/index";
import { MockSigner, SessionKeyService, MOCK_TARGETS } from "../../src/sessionkeys/service";
import { MemStore } from "../../src/store";
import { env } from "../helpers";
const { registry } = env();
const collect = async (g: AsyncGenerator<any>) => { const o: any[] = []; for await (const e of g) o.push(e); return o; };
describe("demo compile", () => {
  it("parses a simple BTC thesis into a valid strategy", async () => {
    const ev = await collect(compile({ thesis: "Buy $200 of BTC perp 3x long when BTC drops below 60000, stop at -5%" }, { registry, stockTokensAllowed: true }));
    const done = ev.find((e) => e.type === "result"); expect(done).toBeTruthy();
    expect(done.strategy.actions[0].instrument).toBe("hl:perp:BTC");
    expect(ev[0].type).toBe("progress");
  });
  it("returns unsupported_prompt with suggestions for unparseable input (no silent fixture fallback)", async () => {
    const ev = await collect(compile({ thesis: "something poetic about markets" }, { registry, stockTokensAllowed: true }));
    expect(ev.find((e) => e.type === "result")).toBeFalsy();
    const err = ev.find((e) => e.type === "error"); expect(err.code).toBe("unsupported_prompt"); expect(err.suggestions.length).toBeGreaterThan(2);
  });
});
describe("session keys (mock signer)", () => {
  const mk = (mode: "mock" | "testnet" = "mock", targets = MOCK_TARGETS as any) => { const store = new MemStore(); return { store, svc: new SessionKeyService(store, registry, new MockSigner(), { mode, targets: () => targets, defaults: { maxDays: 30, perTxUsd: 250, dailyUsd: 1000 }, now: () => Date.parse("2026-10-27T00:00:00Z"), signingAvailable: true }) }; };
  const req = { chainId: 46630 as const, tokens: ["robinhood:token:0x00000000000000000000000000000000000000a1"], perTxCapUsd: "500", dailyCapUsd: "2000", expiresInDays: 7 };
  it("prepare -> owner signs -> active -> revoke", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()); const { svc } = mk();
    const p = svc.prepare("u1", owner.address, req as any);
    expect(p.humanReadable.join(" ")).toMatch(/Cannot transfer/); expect(JSON.stringify(p)).not.toMatch(/privateKey/i);
    const d: any = p.signatureRequest.data;
    const sig = await owner.signTypedData({ ...d, message: { ...d.message, expiresAt: BigInt(d.message.expiresAt) } });
    expect((await svc.submit("u1", owner.address, p.sessionKeyId, sig)).status).toBe("active");
    expect(svc.revoke("u1", p.sessionKeyId).sessionKey.status).toBe("revoked");
  });
  it("rejects a signature from another wallet", async () => {
    const owner = privateKeyToAccount(generatePrivateKey()), evil = privateKeyToAccount(generatePrivateKey()); const { svc } = mk();
    const p = svc.prepare("u1", owner.address, req as any); const d: any = p.signatureRequest.data;
    const sig = await evil.signTypedData({ ...d, message: { ...d.message, expiresAt: BigInt(d.message.expiresAt) } });
    await expect(svc.submit("u1", owner.address, p.sessionKeyId, sig)).rejects.toThrow(/does not match/);
  });
  it("fails closed on testnet without verified targets or with mock token addresses", () => {
    expect(() => mk("testnet", null).svc.prepare("u1", "0x0000000000000000000000000000000000000001", req as any)).toThrow(/fail closed/);
    expect(() => mk("testnet").svc.prepare("u1", "0x0000000000000000000000000000000000000001", req as any)).toThrow(/unverified/);
  });
  it("enforces cap sanity and max expiry", () => {
    expect(() => mk().svc.prepare("u1", "0x0000000000000000000000000000000000000001", { ...req, dailyCapUsd: "100" } as any)).toThrow();
    expect(() => mk().svc.prepare("u1", "0x0000000000000000000000000000000000000001", { ...req, expiresInDays: 31 } as any)).toThrow();
  });
});
