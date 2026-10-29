// M5.0 — read-only chain adapter: method allowlist, chain-id pin, timeouts (no network).
import { describe, expect, it } from "vitest";
import { ChainReader, ChainMismatch, READ_METHODS, ReadOnlyViolation, guard, type Eip1193 } from "../../src/chain/reader";

const fake = (chainId: number, extra: Record<string, unknown> = {}) => { const seen: string[] = [];
  const t: Eip1193 = { request: async ({ method }) => { seen.push(method);
    if (method === "eth_chainId") return "0x" + chainId.toString(16); if (method === "eth_blockNumber") return "0x10";
    if (method === "eth_getBalance") return "0x5"; if (method === "eth_getCode") return "0x"; if (method in extra) return extra[method];
    throw new Error("unexpected " + method); } };
  return { t, seen }; };

describe("M5.0 read-only guard", () => {
  it("refuses every write/sign method before any I/O", async () => {
    const { t, seen } = fake(46630); const g = guard(t);
    for (const m of ["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign", "eth_signTypedData_v4", "eth_accounts", "anvil_setBalance", "wallet_sendCalls"])
      await expect(g.request({ method: m })).rejects.toBeInstanceOf(ReadOnlyViolation);
    expect(seen).toEqual([]);
    expect([...READ_METHODS].every((m) => /^eth_(chainId|blockNumber|getCode|getBalance|call|getBlockByNumber)$/.test(m))).toBe(true);
  });
  it("status on the right chain reports the block; wrong chain fails closed", async () => {
    expect(await new ChainReader({ chainId: 46630, transport: fake(46630).t }).status()).toEqual({ reachable: true, chainIdMatches: true, blockNumber: "16", reason: null });
    const bad = await new ChainReader({ chainId: 46630, transport: fake(4663).t }).status();
    expect(bad).toMatchObject({ reachable: true, chainIdMatches: false, blockNumber: null }); expect(bad.reason).toContain("4663");
    await expect(new ChainReader({ chainId: 46630, transport: fake(4663).t }).account("0x" + "11".repeat(20) as `0x${string}`)).rejects.toBeInstanceOf(ChainMismatch);
  });
  it("account with no code returns balance only", async () => {
    const r = await new ChainReader({ chainId: 46630, transport: fake(46630).t }).account(("0x" + "11".repeat(20)) as `0x${string}`);
    expect(r).toMatchObject({ chainId: 46630, readOnly: true, nativeBalanceWei: "5", hasCode: false, codeCheck: "no_code", account: null, blockNumber: "16" });
  });
  it("hung RPC → unreachable within the timeout", async () => {
    const hang: Eip1193 = { request: () => new Promise(() => {}) }; const t0 = Date.now();
    const s = await new ChainReader({ chainId: 46630, transport: hang, timeoutMs: 300 }).status();
    expect(s.reachable).toBe(false); expect(s.reason).toContain("timeout"); expect(Date.now() - t0).toBeLessThan(2000);
  });
});
