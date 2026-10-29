/**
 * Local anvil end-to-end: deploy TEST tokens + constant-product pool + Chainlink-shaped aggregator +
 * SessionAccount, then (1) read the aggregator through the fail-closed ChainlinkReader and (2) execute a
 * session-key swap and prove a transfer is denied. Throwaway keys are generated in memory (never on disk).
 * Skips if Foundry (anvil/forge) is not installed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAnvil } from "../anvil";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseUnits, hashMessage, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { Verified } from "../../src/verify/loader";
import { VerifiedFile } from "../../src/verify/schema";
import { ChainlinkReader, type ReadClient } from "../../src/venues/chainlink";

const BIN = join(homedir(), ".foundry/bin"); const HAS = existsSync(join(BIN, "anvil"));
const AN = HAS ? await startAnvil(31337) : null; const RPC = AN?.rpc ?? "http://127.0.0.1:1"; // M5.27: free port per file
const art = (f: string, c: string) => { const j = JSON.parse(readFileSync(`foundry/out/${f}/${c}.json`, "utf8")); return { abi: j.abi, bytecode: j.bytecode.object as Hex }; };

describe.skipIf(!HAS)("anvil e2e (local only)", () => {
  let anvil: ChildProcess;
  const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const owner = privateKeyToAccount(generatePrivateKey()); const sk = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account: owner, chain: foundry, transport: http(RPC), pollingInterval: 50 });
  const A: Record<string, Hex> = {};
  const deploy = async (f: string, c: string, args: unknown[]) => {
    const a = art(f, c); const h = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    return (await pub.waitForTransactionReceipt({ hash: h })).contractAddress!;
  };
  const send = async (address: Hex, f: string, c: string, functionName: string, args: unknown[]) => {
    const h = await wallet.writeContract({ address, abi: art(f, c).abi, functionName, args }); const r = await pub.waitForTransactionReceipt({ hash: h }); return r;
  };

  beforeAll(async () => {
    anvil = AN!.proc;
    await pub.request({ method: "anvil_setBalance" as never, params: [owner.address, "0x56BC75E2D63100000"] as never }); // 100 local ETH
    A.usdg = await deploy("MockERC20.sol", "MockERC20", ["Test USDG", "tUSDG", 6]);
    A.nvda = await deploy("MockERC20.sol", "MockERC20", ["Test NVDA", "tNVDA", 18]);
    A.pool = await deploy("MockPool.sol", "MockPool", [A.usdg, A.nvda]);
    A.feed = await deploy("MockAggregator.sol", "MockAggregator", ["NVDA / USD"]);
    A.acct = await deploy("SessionAccount.sol", "SessionAccount", [owner.address]);
  }, 60_000);
  afterAll(() => { anvil?.kill(); });

  it("ChainlinkReader reads a verified local feed and refuses after code swap", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [p, dt] of [[21000000000n, 7200], [21500000000n, 3600], [21561651744n, 10]] as const) await send(A.feed, "MockAggregator.sol", "MockAggregator", "push", [p, BigInt(now - dt)]);
    const code = await pub.getCode({ address: A.feed });
    const v = new Verified(VerifiedFile.parse({ chainId: 31337, network: "anvil", generatedAt: new Date().toISOString(), rpc: RPC, items: [],
      feeds: [{ symbol: "NVDA", name: "NVDA / USD", proxy: A.feed, chainId: 31337, decimals: 8, description: "NVDA / USD", heartbeatSec: 86400, bytecodeHash: keccak256(code!),
        sourceUrl: "https://example.invalid/local-anvil", checkedAt: new Date().toISOString(), lastAnswer: null, lastUpdatedAt: null, usage: "mainnet-readonly" }] }));
    const r = new ChainlinkReader(pub as unknown as ReadClient, v);
    expect((await r.latest("NVDA"))!.value).toBeCloseTo(215.61651744, 8);
    const h = await r.history("NVDA", (now - 8000) * 1000);
    expect(h.map((x) => x.answer)).toEqual([210, 215, 215.61651744]);
    await pub.request({ method: "anvil_setCode" as never, params: [A.feed, "0x6000"] as never });
    await expect(new ChainlinkReader(pub as unknown as ReadClient, v).latest("NVDA")).rejects.toThrow(/bytecode/);
  }, 60_000);

  it("session-key swap succeeds on the local pool; transfer via session key is denied", async () => {
    const T = ["MockERC20.sol", "MockERC20"] as const, P = ["MockPool.sol", "MockPool"] as const, S = ["SessionAccount.sol", "SessionAccount"] as const;
    await send(A.usdg, ...T, "mint", [owner.address, parseUnits("1000000", 6)]); await send(A.nvda, ...T, "mint", [owner.address, parseUnits("5000", 18)]);
    await send(A.usdg, ...T, "approve", [A.pool, 2n ** 256n - 1n]); await send(A.nvda, ...T, "approve", [A.pool, 2n ** 256n - 1n]);
    await send(A.pool, ...P, "addLiquidity", [parseUnits("1000000", 6), parseUnits("5000", 18)]);
    await send(A.usdg, ...T, "mint", [A.acct, parseUnits("1000", 6)]);
    await send(A.acct, ...S, "ownerCall", [A.usdg, encodeFunctionData({ abi: art(...T).abi, functionName: "approve", args: [A.pool, 2n ** 256n - 1n] })]);
    const fU = await deploy("MockAggregator.sol", "MockAggregator", ["USDG / USD"]), fN = await deploy("MockAggregator.sol", "MockAggregator", ["NVDA / USD"]);
    const block = await pub.getBlock();
    await send(fU, "MockAggregator.sol", "MockAggregator", "push", [100000000n, block.timestamp]); await send(fN, "MockAggregator.sol", "MockAggregator", "push", [20000000000n, block.timestamp]);
    await send(A.acct, ...S, "setFeed", [A.usdg, fU, 3600]); await send(A.acct, ...S, "setFeed", [A.nvda, fN, 3600]);
    await send(A.acct, ...S, "allow", [A.pool, "0x" + encodeFunctionData({ abi: art(...P).abi, functionName: "swapExactIn", args: [A.usdg, 1n, 1n, A.acct, 1n] }).slice(2, 10), 1]); // Kind.SwapExactInV1
    // per-token caps in token units (USDG, 6 dec), 1% max slippage vs the oracle floor
    await send(A.acct, ...S, "grant", [sk.address, block.timestamp + 86400n, 100, [A.usdg], [parseUnits("250", 6)], [parseUnits("1000", 6)]]);
    const quote = (await pub.readContract({ address: A.pool, abi: art(...P).abi, functionName: "quote", args: [A.usdg, parseUnits("200", 6)] })) as bigint;
    const minOut = (quote * 9950n) / 10000n; // 50 bps slippage
    const viaSession = async (target: Hex, data: Hex) => {
      const deadline = block.timestamp + 600n;
      const d = (await pub.readContract({ address: A.acct, abi: art(...S).abi, functionName: "digest", args: [sk.address, target, data, deadline] })) as Hex;
      const sig = await sk.signMessage({ message: { raw: d } }); expect(hashMessage({ raw: d })).toMatch(/^0x/);
      return send(A.acct, ...S, "executeAsSession", [sk.address, target, data, deadline, sig]);
    };
    const swap = encodeFunctionData({ abi: art(...P).abi, functionName: "swapExactIn", args: [A.usdg, parseUnits("200", 6), minOut, A.acct, block.timestamp + 600n] });
    const rc = await viaSession(A.pool, swap); expect(rc.status).toBe("success");
    const got = (await pub.readContract({ address: A.nvda, abi: art(...T).abi, functionName: "balanceOf", args: [A.acct] })) as bigint;
    expect(got).toBe(quote);
    const steal = encodeFunctionData({ abi: art(...T).abi, functionName: "transfer", args: [sk.address, 1n] });
    await expect(viaSession(A.usdg, steal)).rejects.toThrow();
    const over = encodeFunctionData({ abi: art(...P).abi, functionName: "swapExactIn", args: [A.usdg, parseUnits("251", 6), 1n, A.acct, block.timestamp + 600n] });
    await expect(viaSession(A.pool, over)).rejects.toThrow();
    const zero = encodeFunctionData({ abi: art(...P).abi, functionName: "swapExactIn", args: [A.usdg, parseUnits("10", 6), 0n, A.acct, block.timestamp + 600n] });
    await expect(viaSession(A.pool, zero)).rejects.toThrow(); // M3.5: minOut=0 rejected on-chain
  }, 60_000);
});
