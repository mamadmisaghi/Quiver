// M5.5: profiles, follow, and PAPER-ONLY copy-trading.
import { z } from "zod";
import { EquityUsd, IsoTime, RunId, StrategyId } from "./common";

export const Handle = z.string().regex(/^@[A-Za-z0-9_.:-]{2,80}$/);
const Text = (max: number) => z.string().max(max).transform((s) => s.replace(/\p{Cc}/gu, " ").trim());
export const PutProfileReq = z.object({ displayName: Text(40).nullable().optional(), bio: Text(280).nullable().optional() })
  .refine((x) => x.displayName !== undefined || x.bio !== undefined, "nothing to update");
export const ProfileStrategy = z.object({ id: z.string(), name: z.string(), venues: z.array(z.string()), forks: z.number().int(), paperReturn30dPct: z.string().nullable(), publishedAt: IsoTime });
export const Profile = z.object({
  handle: Handle, displayName: z.string().nullable(), bio: z.string().nullable(), isYou: z.boolean(), isFollowing: z.boolean(), demo: z.boolean(),
  /** M5.10: true = no public strategies, so displayName/bio/following are withheld (null). */ limited: z.boolean(),
  followers: z.number().int(), following: z.number().int().nullable(), strategies: z.array(ProfileStrategy), bestPaperReturn30dPct: z.string().nullable(),
});
export const FollowRes = z.object({ handle: Handle, following: z.boolean(), followers: z.number().int() });
export const FollowingRes = z.object({ items: z.array(z.object({ handle: Handle, displayName: z.string().nullable(), strategies: z.number().int() })) });
export const MAX_FOLLOWING = 500;

export const CopyReq = z.object({
  publicStrategyId: StrategyId, mode: z.literal("paper").default("paper"), // anything else -> 422; copy-trading is paper-only
  startingEquityUsd: EquityUsd.default("10000"), approvalMode: z.enum(["auto", "confirm_each"]).default("auto"),
});
export const CopyView = z.object({
  strategyId: StrategyId, publicStrategyId: z.string(), sourceHandle: Handle, sourceName: z.string(), sourceVersion: z.number().int(), latestSourceVersion: z.number().int().nullable(), // null = source unpublished
  behind: z.boolean(), /** M5.10: unfollowed -> run stopped, sync blocked */ detached: z.boolean(), detachedAt: IsoTime.nullable(), mode: z.literal("paper"), runId: RunId.nullable(), runStatus: z.string().nullable(), copiedAt: IsoTime, syncedAt: IsoTime,
});
export const CopyListRes = z.object({ items: z.array(CopyView), notice: z.string() });

/** M5.12: activity feed (followed traders' public strategy activity + your own runs and copies). Newest first, cursor-paginated. */
export const ActivityKind = z.enum(["strategy_published", "strategy_updated", "run_started", "run_stopped", "copy_started", "copy_detached"]);
export const ActivityQuery = z.object({
  cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
  scope: z.enum(["all", "following", "mine"]).default("all"),
  /** M5.16: a trader's public activity only (scope is ignored). Unknown handle = 404. */
  handle: Handle.optional(),
});
export const ActivityItem = z.object({
  id: z.string(), kind: ActivityKind, at: IsoTime,
  actor: z.object({ handle: Handle, isYou: z.boolean() }),
  /** publicStrategyId is set only when the strategy is public; private strategy ids never appear. */
  strategy: z.object({ publicStrategyId: z.string().nullable(), name: z.string(), version: z.number().int().nullable() }),
  /** Only on your own items. */
  run: z.object({ runId: RunId, mode: z.enum(["paper", "testnet", "live"]), status: z.string() }).nullable(),
});
export const ActivityRes = z.object({ items: z.array(ActivityItem), nextCursor: z.string().nullable(), /** M5.16: set on ?handle= (true = no public strategies, so nothing is shown) */ limited: z.boolean().optional() });

// ---------- M5.17 global search (⌘K): markets, public strategies, traders ----------
export const SearchQuery = z.object({ q: z.string().trim().min(1).max(80), limit: z.coerce.number().int().min(1).max(20).default(8) });
export const SearchRes = z.object({
  /** M5.20: the query is no longer echoed (kept optional for older clients). */ q: z.string().optional(),
  markets: z.array(z.object({ id: z.string(), symbol: z.string(), name: z.string(), venue: z.string(), assetClass: z.string() })),
  strategies: z.array(z.object({ publicStrategyId: z.string(), name: z.string(), handle: Handle })),
  traders: z.array(z.object({ handle: Handle, strategies: z.number().int(), isYou: z.boolean() })),
});
