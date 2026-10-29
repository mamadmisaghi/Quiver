// M4.8 — public (no-auth) leaderboard and shareable run result cards. Nothing here carries emails, user ids, run ids or USD account values.
import { z } from "zod";
import { Decimal, IsoTime, StrategyId, Venue } from "./common";

export const PublicLeaderboardQuery = z.object({
  period: z.enum(["7d", "30d", "all"]).default("30d"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
/** One opt-in public strategy. `publicStrategyId` is the already-public id used by GET /v1/public/strategies/:id (links only). */
export const PublicLeaderboardItem = z.object({
  rank: z.number().int().min(1),
  handle: z.string(), // "@label"; never an email (labels that look like one are replaced with "@trader_<hash>")
  strategyName: z.string(),
  publicStrategyId: StrategyId,
  venues: z.array(Venue),
  basis: z.enum(["paper", "backtest"]), // paper = owner's latest paper run in the period with ≥ minTrades fills; else a backtest over the period
  returnPct: Decimal, maxDrawdownPct: Decimal.nullable(), winRatePct: Decimal.nullable(),
  trades: z.number().int().min(0),
  spark: z.array(z.number()), // equity in % of start (100 = flat)
});
export const PublicLeaderboardRes = z.object({
  period: z.enum(["7d", "30d", "all"]), minTrades: z.number().int().min(0),
  items: z.array(PublicLeaderboardItem), asOf: IsoTime, synthetic: z.boolean(), notice: z.string(),
});

export const CardShareToken = z.string().regex(/^crd_[A-Za-z0-9_-]{32}$/);
export const CardShareRes = z.object({ token: CardShareToken, path: z.string(), createdAt: IsoTime });
export const CardRevokeRes = z.object({ revoked: z.number().int().min(0) });
/** Sanitized public result card: percentages and counts only. */
export const PublicCard = z.object({
  strategyName: z.string(), handle: z.string(), mode: z.enum(["paper", "testnet"]),
  status: z.enum(["running", "paused", "stopped", "halted"]),
  venues: z.array(Venue), startedAt: IsoTime, stoppedAt: IsoTime.nullable(), durationSec: z.number().int().min(0),
  returnPct: Decimal, maxDrawdownPct: Decimal, trades: z.number().int().min(0), triggerFires: z.number().int().min(0),
  spark: z.array(z.number()), // equity in % of start (100 = flat)
  synthetic: z.boolean(), sharedAt: IsoTime, asOf: IsoTime, disclaimer: z.string(),
});

// ---------- M5.20 public profile (no auth). Same M5.10 limited rule; no user ids, DIDs or emails. ----------
export const PublicProfile = z.object({
  handle: z.string(), exists: z.literal(true),
  /** true = account with no public strategies: personal fields are null */ limited: z.boolean(),
  displayName: z.string().nullable(), bio: z.string().nullable(),
  publicStrategies: z.number().int().min(0), followers: z.number().int().min(0), demo: z.boolean(),
}).strict();
