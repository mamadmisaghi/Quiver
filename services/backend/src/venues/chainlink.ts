import type { Hex } from "viem";
import type { VerifiedFeed } from "../verify/schema";
import { UnverifiedError, type Verified } from "../verify/loader";
import type { PricePoint } from "./market";

export const AGGREGATOR_ABI = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
  { type: "function", name: "getRoundData", stateMutability: "view", inputs: [{ name: "_roundId", type: "uint80" }], outputs: [
    { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** The subset of a viem PublicClient we use: read-only eth_call / eth_getCode. Nothing here can sign or send. */
export interface ReadClient {
  readContract(args: { address: Hex; abi: typeof AGGREGATOR_ABI; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  getCode(args: { address: Hex }): Promise<Hex | undefined>;
}

export type Round = { roundId: bigint; answer: number; updatedAt: number };
export const SOURCE = "chainlink_mainnet_readonly";

/**
 * Read-only Chainlink reader for 'mainnet-readonly' prices (paper + backtest). Only feeds listed in the
 * verified file are readable; the proxy's bytecode hash is re-checked once per process. Stale or
 * non-positive answers return null (engine treats as unknown → no fire), never a guess.
 */
export class ChainlinkReader {
  private checked = new Set<string>();
  constructor(private client: ReadClient, private verified: Verified, private now: () => number = Date.now, private graceSec = 600) {}

  private async feed(symbol: string): Promise<VerifiedFeed> {
    const f = this.verified.requireFeed(symbol);
    if (!this.checked.has(f.proxy)) {
      const code = await this.client.getCode({ address: f.proxy as Hex });
      const { keccak256 } = await import("viem");
      if (!code || code === "0x" || keccak256(code).toLowerCase() !== f.bytecodeHash.toLowerCase())
        throw new UnverifiedError(`Feed ${symbol} proxy bytecode does not match verified hash; failing closed.`);
      this.checked.add(f.proxy);
    }
    return f;
  }
  private toRound(r: readonly unknown[], dec: number): Round {
    return { roundId: r[0] as bigint, answer: Number(r[1] as bigint) / 10 ** dec, updatedAt: Number(r[3] as bigint) * 1000 };
  }
  async latest(symbol: string): Promise<PricePoint | null> {
    const f = await this.feed(symbol);
    const r = (await this.client.readContract({ address: f.proxy as Hex, abi: AGGREGATOR_ABI, functionName: "latestRoundData" })) as readonly unknown[];
    const x = this.toRound(r, f.decimals);
    if (!(x.answer > 0) || x.updatedAt === 0) return null;
    if (this.now() - x.updatedAt > (f.heartbeatSec + this.graceSec) * 1000) return null; // stale
    return { value: x.answer, observedAt: x.updatedAt, source: SOURCE };
  }
  /**
   * Walk rounds backwards from latest until `sinceMs` or `maxRounds` (Chainlink proxy round ids encode
   * phase<<64 | aggregatorRound; we stop at a phase boundary rather than guessing into older phases).
   */
  /** Rounds that could not be read after retries in the last history() call, per symbol (reported as data gaps). */
  gaps = new Map<string, number>();
  private async readRound(addr: Hex, id: bigint, dec: number, tries = 3): Promise<Round | null | "fail"> {
    for (let k = 0; k < tries; k++) {
      try { const r = await this.client.readContract({ address: addr, abi: AGGREGATOR_ABI, functionName: "getRoundData", args: [id] }); const x = this.toRound(r as readonly unknown[], dec); return x.updatedAt === 0 ? null : x; }
      catch { if (k < tries - 1) await new Promise((res) => setTimeout(res, 150 * (k + 1))); }
    }
    return "fail";
  }
  /**
   * Walk rounds backwards from latest within the current phase until `sinceMs`, round 1 or `maxRounds`.
   * Transient RPC failures are retried (3x, backoff) and then skipped as gaps instead of ending the walk;
   * the walk ends early only on an empty round (updatedAt = 0) or 3 consecutive chunks that all failed.
   * Implausible answers (> 5x or < 0.2x the local median, e.g. mis-scaled bootstrap rounds) are dropped.
   */
  async history(symbol: string, sinceMs: number, maxRounds = 10_000, chunk = 50): Promise<Round[]> {
    const f = await this.feed(symbol);
    const last = this.toRound((await this.client.readContract({ address: f.proxy as Hex, abi: AGGREGATOR_ABI, functionName: "latestRoundData" })) as readonly unknown[], f.decimals);
    const out: Round[] = [last];
    const phase = last.roundId >> 64n; let agg = last.roundId & ((1n << 64n) - 1n);
    let done = false, gaps = 0, deadChunks = 0, n = 1;
    while (!done && n < maxRounds && agg > 1n && out[out.length - 1].updatedAt > sinceMs) {
      const ids: bigint[] = []; for (let k = 0; k < chunk && agg - BigInt(k + 1) >= 1n && n + k < maxRounds; k++) ids.push(agg - BigInt(k + 1));
      agg -= BigInt(ids.length); n += ids.length;
      const res = await Promise.all(ids.map((id) => this.readRound(f.proxy as Hex, (phase << 64n) | id, f.decimals)));
      const fails = res.filter((x) => x === "fail").length; gaps += fails; deadChunks = fails === res.length ? deadChunks + 1 : 0;
      if (deadChunks >= 3) break;
      for (const x of res) { if (x === "fail") continue; if (!x) { done = true; break; } out.push(x); if (x.updatedAt <= sinceMs) { done = true; break; } }
    }
    this.gaps.set(symbol, gaps);
    return dropOutliers(out.reverse().filter((x) => x.answer > 0).sort((a, b) => a.updatedAt - b.updatedAt));
  }
}

export function dropOutliers(r: Round[], w = 5): Round[] {
  return r.filter((x, i) => {
    const nb = r.slice(Math.max(0, i - w), i + w + 1).filter((_, j) => j !== Math.min(i, w)).map((y) => y.answer).sort((a, b) => a - b);
    if (nb.length < 3) return true;
    const med = nb[nb.length >> 1]; return x.answer < med * 5 && x.answer > med / 5;
  });
}

/** Last-observation-carried-forward price at t from ascending rounds (no look-ahead). */
export function priceAt(rounds: Round[], t: number): number | null {
  let lo = 0, hi = rounds.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rounds[m].updatedAt <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : rounds[ans].answer;
}
