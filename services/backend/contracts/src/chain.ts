// M5.0: read-only chain adapters (testnet 46630 + local anvil). No signing, no writes.
import { z } from "zod";
import { EvmAddress } from "./common";

export const ChainNetwork = z.enum(["robinhood-testnet", "anvil"]);
export const ChainStatusRes = z.object({
  /** M5.10: false = CHAIN_READS_ENABLED is off. Still HTTP 200; reachable=false, chainIdMatches/blockNumber=null. */
  enabled: z.boolean(),
  chainId: z.number().int(), network: ChainNetwork, readOnly: z.literal(true),
  reachable: z.boolean(), chainIdMatches: z.boolean().nullable(), blockNumber: z.string().nullable(),
  /** Always false in M5.0: no verified testnet DEX/Stock Tokens (V1–V4 fail). */
  tradable: z.literal(false),
  verification: z.array(z.object({ id: z.string(), status: z.string() })),
  reasons: z.array(z.string()), checkedAt: z.string(),
});
export type ChainStatusRes = z.infer<typeof ChainStatusRes>;

export const SessionOnchain = z.object({
  key: EvmAddress, exists: z.boolean(), revoked: z.boolean(), expiry: z.number().int(), maxSlippageBps: z.number().int(), nonce: z.string(),
  caps: z.array(z.object({ token: EvmAddress, allowed: z.boolean(), perTxCap: z.string(), windowCap: z.string(), spentInWindow: z.string() })),
});
export const AccountReadRes = z.object({
  chainId: z.number().int(), address: EvmAddress, readOnly: z.literal(true), blockNumber: z.string(), nativeBalanceWei: z.string(),
  hasCode: z.boolean(),
  /** "match" = runtime bytecode hash equals the expected SessionAccount hash; "mismatch" = fail closed (no account fields); "unchecked" = no expected hash configured. */
  codeCheck: z.enum(["match", "mismatch", "unchecked", "no_code"]),
  account: z.object({ owner: EvmAddress, slippageCapBps: z.number().int(), sequencerFeed: EvmAddress, sequencerGrace: z.number().int(), session: SessionOnchain.nullable() }).nullable(),
});
export type AccountReadRes = z.infer<typeof AccountReadRes>;
