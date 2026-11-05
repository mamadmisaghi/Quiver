import { z } from "zod";
import { randomBytes } from "node:crypto";
import { reconcileTestSwap, type ReadRpc, type TestVenue } from "./rh-receipt";
import { HostError } from "../workflows/host";
import type { MemStore } from "../store";
import type { Hex, Address } from "viem";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  contract = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), runtimeHash: hash });
const manifest = z.object({ genesisHash: hash, pool: contract, token0: contract, token1: contract });
export type PreparedReceipt = {
  owner: string;
  wallet: Address;
  tokenIn: Address;
  tokenOut: Address;
  units: string;
  minimum: string;
  deadline: number;
  block: string;
  time: string;
  nonce: string;
  pins: TestVenue;
  hash?: Hex;
  inclusion?: { number: string; hash: Hex };
  result?: { state: string; amountOut?: string; reason?: string };
};
export class TestPoolReceipts {
  private pins?: TestVenue;
  private locks = new Set<string>();
  constructor(
    private store: MemStore,
    private rpcUrl: string | undefined,
    document: string | undefined,
    private commit: () => Promise<void>,
  ) {
    if (document) this.pins = manifest.parse(JSON.parse(document)) as TestVenue;
  }
  private async rpc(method: string, params: readonly unknown[]) {
    if (!this.rpcUrl) throw new HostError(503, "The testnet archive endpoint is not configured.");
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new HostError(503, "Testnet history unavailable.");
    const reply = (await response.json()) as { result?: unknown; error?: unknown };
    if (reply.error || reply.result === undefined) throw new HostError(503, "Testnet history unavailable.");
    return reply.result;
  }
  async prepare(
    owner: string,
    wallet: Address,
    pool: string,
    tokenIn: string,
    tokenOut: string,
    units: string,
    minimum: string,
    deadline: number,
    needsApproval: boolean,
  ) {
    if (!this.pins || !this.rpcUrl) return undefined;
    const pins = this.pins,
      tokens = [pins.token0.address.toLowerCase(), pins.token1.address.toLowerCase()];
    if (
      pins.pool.address.toLowerCase() !== pool.toLowerCase() ||
      tokenIn.toLowerCase() === tokenOut.toLowerCase() ||
      ![tokenIn, tokenOut].every((a) => tokens.includes(a.toLowerCase()))
    )
      throw new HostError(409, "Test pool deployment does not match the pinned manifest.");
    if ([...this.store.testPoolReceipts.values()].filter((x) => x.owner === owner).length >= 200)
      throw new HostError(429, "Receipt retention limit reached.");
    const [head, pending, chain] = await Promise.all([
      this.rpc("eth_getBlockByNumber", ["latest", false]),
      this.rpc("eth_getTransactionCount", [wallet, "pending"]),
      this.rpc("eth_chainId", []),
    ]);
    const hex = z.string().regex(/^0x[0-9a-fA-F]+$/),
      b = z.object({ number: hex, timestamp: hex }).parse(head);
    if (BigInt(hex.parse(chain)) !== 46630n || BigInt(b.timestamp) >= BigInt(deadline))
      throw new HostError(409, "Testnet chain or quote deadline changed.");
    const id = randomBytes(16).toString("hex");
    this.store.testPoolReceipts.set(id, {
      owner,
      wallet,
      tokenIn: tokenIn as Address,
      tokenOut: tokenOut as Address,
      units,
      minimum,
      deadline,
      block: b.number,
      time: b.timestamp,
      nonce: String(BigInt(hex.parse(pending)) + (needsApproval ? 1n : 0n)),
      pins,
    });
    return id;
  }
  async check(owner: string, id: string, tx: Hex) {
    const p = this.store.testPoolReceipts.get(id);
    if (!p || p.owner !== owner) throw new HostError(404, "Testnet swap intent not found.");
    tx = hash.parse(tx).toLowerCase() as Hex;
    if (
      (p.hash && p.hash !== tx) ||
      [...this.store.testPoolReceipts.values()].some((x) => x !== p && x.hash === tx)
    )
      throw new HostError(409, "The transaction is already bound to another intent.");
    if (this.locks.has(id)) throw new HostError(409, "Receipt verification is in progress.");
    this.locks.add(id);
    try {
      p.hash = tx;
      await this.commit();
      const intent = {
        owner: p.wallet,
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: BigInt(p.units),
        minOut: BigInt(p.minimum),
        deadline: BigInt(p.deadline),
        afterBlock: BigInt(p.block),
        preparedAtBlockTime: BigInt(p.time),
        nonce: BigInt(p.nonce),
        txHash: tx,
        route: { kind: "direct" as const },
      };
      const out = await reconcileTestSwap(
        this.rpc.bind(this) as ReadRpc,
        p.pins,
        intent,
        p.inclusion ? { number: BigInt(p.inclusion.number), hash: p.inclusion.hash } : undefined,
      );
      if (out.inclusion) p.inclusion = { number: String(out.inclusion.number), hash: out.inclusion.hash };
      p.result = {
        state: out.state,
        ...("amountOut" in out ? { amountOut: String(out.amountOut) } : {}),
        ...("reason" in out ? { reason: out.reason } : {}),
      };
      await this.commit();
      return p.result;
    } finally {
      this.locks.delete(id);
    }
  }
}
