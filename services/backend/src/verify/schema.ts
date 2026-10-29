import { z } from "zod";

export const Status = z.enum(["pass", "fail", "partial", "blocked", "pending", "n/a"]);
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
export const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

/** One verified fact. `value` is only usable when status === "pass" (fail closed). */
export const VerifiedItem = z.object({
  id: z.string(), title: z.string(), status: Status,
  value: z.unknown().nullable(),
  sourceUrl: z.string().url().nullable(), checkedAt: z.string().datetime(),
  method: z.string(), bytecodeHash: Hex.nullable(), note: z.string().nullable(),
});
export type VerifiedItem = z.infer<typeof VerifiedItem>;

export const VerifiedFeed = z.object({
  symbol: z.string(), name: z.string(), proxy: Addr, chainId: z.number().int(),
  decimals: z.number().int(), description: z.string(), heartbeatSec: z.number().int().positive(),
  bytecodeHash: Hex, sourceUrl: z.string().url(), checkedAt: z.string().datetime(),
  lastAnswer: z.number().nullable(), lastUpdatedAt: z.string().datetime().nullable(),
  usage: z.literal("mainnet-readonly"),
});
export type VerifiedFeed = z.infer<typeof VerifiedFeed>;

export const VerifiedFile = z.object({
  chainId: z.number().int(), network: z.string(), generatedAt: z.string().datetime(),
  rpc: z.string().url(), items: z.array(VerifiedItem), feeds: z.array(VerifiedFeed).default([]),
});
export type VerifiedFile = z.infer<typeof VerifiedFile>;
