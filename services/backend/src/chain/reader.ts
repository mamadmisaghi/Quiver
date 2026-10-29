/**
 * M5.0: read-only chain adapter. Every RPC goes through a method allowlist, so this module cannot send a
 * transaction or sign anything even if a caller tries (eth_sendRawTransaction, eth_sign, personal_sign... are refused
 * before any network I/O). The chain id is pinned: a node that reports another id fails closed.
 */
import { createPublicClient, custom, http, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import type { AccountReadRes } from "../../contracts/src/chain";

export const READ_METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_getBalance", "eth_call", "eth_getBlockByNumber"]);
export class ReadOnlyViolation extends Error { constructor(public method: string) { super(`read-only adapter refused ${method}`); } }
export class ChainMismatch extends Error { constructor(public expected: number, public got: number) { super(`chain id mismatch: expected ${expected}, node reports ${got}`); } }

export type Eip1193 = { request: (a: { method: string; params?: unknown }) => Promise<unknown> };
/** Wrap any EIP-1193 transport so only read methods pass. Exported for tests. */
export const guard = (inner: Eip1193): Eip1193 => ({
  request: async (a) => { if (!READ_METHODS.has(a.method)) throw new ReadOnlyViolation(a.method); return inner.request(a); },
});

export const SESSION_ACCOUNT_READ_ABI = parseAbi([
  "function owner() view returns (address)",
  "function slippageCapBps() view returns (uint16)",
  "function sequencerFeed() view returns (address)",
  "function sequencerGrace() view returns (uint32)",
  "function sessions(address) view returns (uint64 expiry, uint16 maxSlippageBps, bool revoked, bool exists)",
  "function tokenCaps(address, address) view returns (uint128 perTxCap, uint128 windowCap, bool allowed)",
  "function nonces(address) view returns (uint256)",
  "function spentInWindow(address key, address token) view returns (uint256)",
]);

export interface ChainReaderOpts { chainId: number; rpcUrl?: string; transport?: Eip1193; timeoutMs?: number; expectedCodeHash?: Hex | null }

export class ChainReader {
  readonly chainId: number; private client: PublicClient; private verifiedId = false; private expectedCodeHash: Hex | null;
  constructor(o: ChainReaderOpts) {
    this.chainId = o.chainId; this.expectedCodeHash = (o.expectedCodeHash?.toLowerCase() as Hex | undefined) ?? null;
    const timeout = o.timeoutMs ?? 4000;
    const inner: Eip1193 = o.transport ?? (() => { const t = http(o.rpcUrl, { timeout, retryCount: 0 })({ chain: undefined, retryCount: 0 }); return { request: (a) => t.request(a as never) }; })();
    const g = guard(inner);
    const timed: Eip1193 = { request: (a) => { let t: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([g.request(a), new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`rpc timeout after ${timeout}ms`)), timeout); })]).finally(() => clearTimeout(t)); } };
    this.client = createPublicClient({ transport: custom(timed, { retryCount: 0 }) }) as PublicClient;
  }

  /** Pins the chain id once per reader; throws ChainMismatch on a wrong node. */
  async assertChain(): Promise<void> {
    if (this.verifiedId) return;
    const got = await this.client.getChainId();
    if (got !== this.chainId) throw new ChainMismatch(this.chainId, got);
    this.verifiedId = true;
  }

  async status(): Promise<{ reachable: boolean; chainIdMatches: boolean | null; blockNumber: string | null; reason: string | null }> {
    try {
      const got = await this.client.getChainId();
      if (got !== this.chainId) return { reachable: true, chainIdMatches: false, blockNumber: null, reason: `node reports chain ${got}, expected ${this.chainId}` };
      this.verifiedId = true;
      return { reachable: true, chainIdMatches: true, blockNumber: (await this.client.getBlockNumber()).toString(), reason: null };
    } catch (e) { let r = e as Error & { cause?: unknown }; while (r.cause instanceof Error) r = r.cause as typeof r;
      return { reachable: false, chainIdMatches: null, blockNumber: null, reason: `rpc unreachable: ${r.message.split("\n")[0].slice(0, 160)}` }; }
  }

  /** Native balance + SessionAccount state at one block. Account fields are withheld when the code hash mismatches. */
  async account(address: Hex, opts: { sessionKey?: Hex; tokens?: Hex[] } = {}): Promise<AccountReadRes> {
    await this.assertChain();
    const blockNumber = await this.client.getBlockNumber();
    const at = { blockNumber } as const;
    const [bal, code] = await Promise.all([this.client.getBalance({ address, ...at }), this.client.getCode({ address, ...at })]);
    const base = { chainId: this.chainId, address, readOnly: true as const, blockNumber: blockNumber.toString(), nativeBalanceWei: bal.toString() };
    if (!code || code === "0x") return { ...base, hasCode: false, codeCheck: "no_code", account: null };
    const h = keccak256(code).toLowerCase();
    const codeCheck = this.expectedCodeHash == null ? "unchecked" : h === this.expectedCodeHash ? "match" : "mismatch";
    if (codeCheck === "mismatch") return { ...base, hasCode: true, codeCheck, account: null };
    const rd = <T>(functionName: string, args: unknown[] = []) => this.client.readContract({ address, abi: SESSION_ACCOUNT_READ_ABI, functionName: functionName as never, args: args as never, ...at }) as Promise<T>;
    let owner: Hex, cap: number, seq: Hex, grace: number;
    try { [owner, cap, seq, grace] = await Promise.all([rd<Hex>("owner"), rd<number>("slippageCapBps"), rd<Hex>("sequencerFeed"), rd<number>("sequencerGrace")]); }
    catch { return { ...base, hasCode: true, codeCheck: "mismatch", account: null }; } // not a SessionAccount: fail closed
    let session: NonNullable<AccountReadRes["account"]>["session"] = null;
    if (opts.sessionKey) {
      const k = opts.sessionKey;
      const [[expiry, maxSlippageBps, revoked, exists], nonce] = await Promise.all([rd<readonly [bigint, number, boolean, boolean]>("sessions", [k]), rd<bigint>("nonces", [k])]);
      const caps = await Promise.all((opts.tokens ?? []).map(async (t) => {
        const [[perTxCap, windowCap, allowed], spent] = await Promise.all([rd<readonly [bigint, bigint, boolean]>("tokenCaps", [k, t]), rd<bigint>("spentInWindow", [k, t])]);
        return { token: t, allowed, perTxCap: perTxCap.toString(), windowCap: windowCap.toString(), spentInWindow: spent.toString() };
      }));
      session = { key: k, exists, revoked, expiry: Number(expiry), maxSlippageBps, nonce: nonce.toString(), caps };
    }
    return { ...base, hasCode: true, codeCheck, account: { owner, slippageCapBps: cap, sequencerFeed: seq, sequencerGrace: grace, session } };
  }
}
