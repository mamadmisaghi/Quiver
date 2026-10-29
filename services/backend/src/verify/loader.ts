import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, type Hex } from "viem";
import { VerifiedFile, type VerifiedFeed, type VerifiedItem } from "./schema";

export class UnverifiedError extends Error { constructor(msg: string) { super(msg); this.name = "UnverifiedError"; } }

/**
 * Fail-closed view over config/verified/<chain>.json. Anything missing, malformed, or not status
 * "pass" is unusable. A missing/invalid file yields an empty view (nothing usable), never a throw at boot.
 */
export class Verified {
  constructor(readonly file: VerifiedFile | null, readonly error: string | null = null) {}
  static load(path: string): Verified {
    const p = resolve(path);
    if (!existsSync(p)) return new Verified(null, `missing ${path}`);
    try {
      const r = VerifiedFile.safeParse(JSON.parse(readFileSync(p, "utf8")));
      return r.success ? new Verified(r.data) : new Verified(null, `invalid ${path}: ${r.error.issues[0]?.message}`);
    } catch (e) { return new Verified(null, `unreadable ${path}: ${(e as Error).message}`); }
  }
  item(id: string): VerifiedItem | undefined { return this.file?.items.find((i) => i.id === id); }
  /** Returns the value only when status is pass; otherwise throws UnverifiedError. */
  require(id: string): unknown {
    const it = this.item(id);
    if (!it || it.status !== "pass" || it.value == null) throw new UnverifiedError(`${id} is not verified (${it?.status ?? "absent"}); failing closed.`);
    return it.value;
  }
  /** M3.3: verified 4663 token address for a symbol (from item rh_tokens_4663; per-token checked), or null. */
  tokenAddress(symbol: string): { address: string; source: string } | null {
    const it = this.item("rh_tokens_4663"); if (!it || (it.status !== "pass" && it.status !== "partial")) return null;
    const v = (it.value as Record<string, { address?: string; source?: string }> | null)?.[symbol.toUpperCase()];
    return v?.address && /^0x[0-9a-fA-F]{40}$/.test(v.address) && v.source ? { address: v.address, source: v.source } : null;
  }
  /** M3.3: verified Solana mint + Jupiter price API, or null. */
  jupiter(): { mint: string; priceApi: string; source: string } | null {
    const it = this.item("jupiter_jup"); const v = it?.value as { mint?: string; priceApi?: string } | null;
    return it?.status === "pass" && v?.mint && v.priceApi && it.sourceUrl ? { mint: v.mint, priceApi: v.priceApi, source: it.sourceUrl } : null;
  }
  usable(id: string) { const it = this.item(id); return !!it && it.status === "pass" && it.value != null; }
  feed(symbol: string): VerifiedFeed | undefined { return this.file?.feeds.find((f) => f.symbol === symbol.toUpperCase()); }
  requireFeed(symbol: string): VerifiedFeed {
    const f = this.feed(symbol);
    if (!f) throw new UnverifiedError(`No verified Chainlink feed for ${symbol}; failing closed.`);
    return f;
  }
}

/** Runtime re-check: on-chain code must still hash to the recorded value (guards against a swapped proxy). */
export async function assertBytecode(getCode: (a: Hex) => Promise<Hex | undefined>, address: Hex, expected: Hex) {
  const code = await getCode(address);
  if (!code || code === "0x") throw new UnverifiedError(`No code at ${address}; failing closed.`);
  const h = keccak256(code);
  if (h.toLowerCase() !== expected.toLowerCase()) throw new UnverifiedError(`Bytecode hash mismatch at ${address}; failing closed.`);
}

/** Testnet execution gate: live swaps need a verified router (V1) or quote API (V2) AND verified tokens (V4). */
export function testnetExecutionStatus(v: Verified): { enabled: boolean; reason: string | null } {
  const router = v.usable("V1") || v.usable("V2");
  const tokens = v.usable("V4");
  if (router && tokens) return { enabled: true, reason: null };
  return { enabled: false, reason: `Live testnet swaps blocked: ${!router ? "no verified DEX on 46630 (V1/V2)" : ""}${!router && !tokens ? "; " : ""}${!tokens ? "no verified Stock Tokens on 46630 (V4)" : ""}. Paper mode only until a testnet DEX exists or we deploy our own test pool.` };
}
