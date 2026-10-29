/**
 * M5.0 — AA on anvil, read through the read-only adapter. A throwaway in-memory owner key (test only, never on disk)
 * deploys SessionAccount and grants a session on local anvil; then the backend's ChainReader (allowlisted reads only)
 * reads it back, and the HTTP route serves it. Skips if Foundry is not installed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAnvil } from "../anvil";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { ChainReader, ReadOnlyViolation, guard } from "../../src/chain/reader";
import { createApp } from "../../src/api/app";
import { loadConfig } from "../../src/config";
import { ManualClock } from "../../src/lib/clock";
import { AccountReadRes, ChainStatusRes } from "../../contracts/src/chain";

const BIN = join(homedir(), ".foundry/bin"); const HAS = existsSync(join(BIN, "anvil"));
const AN = HAS ? await startAnvil(31337) : null; const RPC = AN?.rpc ?? "http://127.0.0.1:1"; // M5.27: free port per file
const art = (f: string, c: string) => { const j = JSON.parse(readFileSync(`foundry/out/${f}/${c}.json`, "utf8")); return { abi: j.abi, bytecode: j.bytecode.object as Hex }; };

describe.skipIf(!HAS)("M5.0 AA on anvil via read-only adapter", () => {
  let anvil: ChildProcess; const A: Record<string, Hex> = {}; let codeHash: Hex;
  const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const owner = privateKeyToAccount(generatePrivateKey()); const sk = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account: owner, chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const deploy = async (f: string, c: string, args: unknown[]) => { const a = art(f, c); const h = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args }); return (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!; };
  let expiry = 0;

  beforeAll(async () => {
    anvil = AN!.proc;
    await pub.request({ method: "anvil_setBalance" as never, params: [owner.address, "0x56BC75E2D63100000"] as never });
    A.usdg = await deploy("MockERC20.sol", "MockERC20", ["Test USDG", "tUSDG", 6]);
    A.acct = await deploy("SessionAccount.sol", "SessionAccount", [owner.address]);
    expiry = Number((await pub.getBlock()).timestamp) + 86400;
    const h = await wallet.writeContract({ address: A.acct, abi: art("SessionAccount.sol", "SessionAccount").abi, functionName: "grant", args: [sk.address, BigInt(expiry), 50, [A.usdg], [100_000_000n], [1_000_000_000n]] });
    await pub.waitForTransactionReceipt({ hash: h });
    codeHash = keccak256((await pub.getCode({ address: A.acct }))!);
  }, 60_000);
  afterAll(() => { anvil?.kill(); });

  it("reads owner, slippage cap, session and caps at one block; code hash matches", async () => {
    const r = await new ChainReader({ chainId: 31337, rpcUrl: RPC, expectedCodeHash: codeHash }).account(A.acct, { sessionKey: sk.address, tokens: [A.usdg] });
    AccountReadRes.parse(r);
    expect(r.codeCheck).toBe("match"); expect(r.account!.owner.toLowerCase()).toBe(owner.address.toLowerCase()); expect(r.account!.slippageCapBps).toBe(100);
    expect(r.account!.session).toMatchObject({ exists: true, revoked: false, expiry, maxSlippageBps: 50, nonce: "0" });
    expect(r.account!.session!.caps).toEqual([{ token: A.usdg, allowed: true, perTxCap: "100000000", windowCap: "1000000000", spentInWindow: "0" }]);
  });
  it("wrong expected code hash fails closed; EOA and non-SessionAccount contracts expose no account fields", async () => {
    const bad = await new ChainReader({ chainId: 31337, rpcUrl: RPC, expectedCodeHash: ("0x" + "ab".repeat(32)) as Hex }).account(A.acct, { sessionKey: sk.address });
    expect(bad).toMatchObject({ hasCode: true, codeCheck: "mismatch", account: null });
    const rd = new ChainReader({ chainId: 31337, rpcUrl: RPC });
    expect(await rd.account(owner.address)).toMatchObject({ hasCode: false, codeCheck: "no_code", account: null });
    expect(await rd.account(A.usdg)).toMatchObject({ hasCode: true, codeCheck: "mismatch", account: null });
    expect((await rd.account(A.acct)).codeCheck).toBe("unchecked");
  });
  it("pinned to 46630, a 31337 node is refused; writes through the guard never reach anvil", async () => {
    const st = await new ChainReader({ chainId: 46630, rpcUrl: RPC }).status();
    expect(st).toMatchObject({ reachable: true, chainIdMatches: false });
    const nonce0 = await pub.getTransactionCount({ address: owner.address });
    const g = guard({ request: (a) => pub.request(a as never) });
    await expect(g.request({ method: "eth_sendTransaction", params: [{ from: owner.address, to: A.acct, value: "0x1" }] })).rejects.toBeInstanceOf(ReadOnlyViolation);
    expect(await pub.getTransactionCount({ address: owner.address })).toBe(nonce0);
  });
  it("HTTP: /chain/testnet/status + /accounts/:address (auth, validation, disabled)", async () => {
    const mk = (chainReader: ChainReader | null) => createApp({ config: loadConfig({ QUIVR_MODE: "mock", DEV_LOGIN_ENABLED: "true" }), clock: new ManualClock(Date.parse("2026-10-27T15:00:00Z")), autoTimers: false, compileDelayMs: 0, chainReader });
    const q = mk(new ChainReader({ chainId: 31337, rpcUrl: RPC, expectedCodeHash: codeHash }));
    const tok = ((await (await q.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m50-anvil-user-aaaaaaaa" }) })).json()) as { accessToken: string }).accessToken;
    const get = (app: typeof q.app, p: string, t: string | null = tok) => app.request("/v1" + p, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    expect((await get(q.app, "/chain/testnet/status", null)).status).toBe(401);
    const st = ChainStatusRes.parse(await (await get(q.app, "/chain/testnet/status")).json());
    expect(st).toMatchObject({ chainId: 31337, network: "anvil", readOnly: true, reachable: true, chainIdMatches: true, tradable: false });
    expect(st.verification.find((v) => v.id === "V1")?.status).toBe("fail"); expect(st.reasons.join(" ")).toContain("blocked");
    const ok = await get(q.app, `/chain/testnet/accounts/${A.acct}?sessionKey=${sk.address}&tokens=${A.usdg}`); expect(ok.status).toBe(200);
    expect(AccountReadRes.parse(await ok.json()).account!.session!.exists).toBe(true);
    expect((await get(q.app, "/chain/testnet/accounts/0x123")).status).toBe(422);
    expect((await get(q.app, `/chain/testnet/accounts/${A.acct}?tokens=${Array(9).fill(A.usdg).join(",")}`)).status).toBe(422);
    const off = mk(null); const tok2 = ((await (await off.app.request("/v1/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "privy", idToken: "dev:m50-anvil-user-bbbbbbbb" }) })).json()) as { accessToken: string }).accessToken;
    expect((await get(off.app, `/chain/testnet/accounts/${A.acct}`, tok2)).status).toBe(503);
    const s2 = await (await get(off.app, "/chain/testnet/status", tok2)).json() as ChainStatusRes; expect(s2).toMatchObject({ chainId: 46630, reachable: false, tradable: false }); expect(s2.reasons[0]).toContain("CHAIN_READS_ENABLED");
  });
});
