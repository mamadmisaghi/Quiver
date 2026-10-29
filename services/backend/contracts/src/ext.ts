// Contract extensions v1.1 (for Wren): equity series, sparklines, node titles, public strategies,
// traders leaderboard, rewards, revenue, skills. Additive: every new field on an existing object has a
// default so v1.0 fixtures still parse.
import { z } from "zod";
import { BacktestId, Decimal, IsoTime, Page, PageQuery, RunId, StrategyId, Venue } from "./common";
import { Humanized, Strategy } from "./strategy";

// ---------- (a) Equity series ----------
/** One point of a paper run or backtest equity series. drawdownPct is ≥ 0 (peak-to-current, in percent). */
export const EquityPoint = z.object({ ts: IsoTime, equityUsd: Decimal, pnlUsd: Decimal, drawdownPct: Decimal });
export const EquitySeriesQuery = z.object({ points: z.coerce.number().int().min(2).max(500).default(200) });
export const EquitySeries = z.object({
  runId: RunId.nullable(), backtestId: BacktestId.nullable(),
  startingEquityUsd: Decimal, points: z.array(EquityPoint), // oldest first, downsampled to <= `points`
  synthetic: z.boolean(), // true in mock mode: prices are synthetic
});

// ---------- (b) Sparklines + node titles ----------
/** Compact price series for list views. Numbers (display only, not for math). Oldest first. */
export const Sparkline = z.object({ resolution: z.enum(["1h", "1d"]), from: IsoTime, to: IsoTime, points: z.array(z.number()) });
/** Graph node for the strategy canvas. Same shape as CompileEvent `partial.node`. Ids are strategy-local (signal/trigger/action ids, "<actionId>.exit"). */
export const StrategyNode = z.object({ id: z.string(), kind: z.enum(["watch", "when", "do", "exit"]), title: z.string(), detail: z.string(), venue: Venue.optional() });

// ---------- (c) Public strategies ----------
export const Author = z.object({ handle: z.string(), isYou: z.boolean() });
export const PublicStrategySummary = z.object({
  id: StrategyId, name: z.string(), author: Author, venues: z.array(Venue), forks: z.number().int().min(0),
  /** Paper return over the last 30 days from a backtest on the venue's data; null if not computed. In mock mode this is SYNTHETIC. */
  paperReturn30dPct: Decimal.nullable(), spark: z.array(z.number()), publishedAt: IsoTime, mock: z.boolean(),
});
export const PublicStrategiesQuery = PageQuery.extend({ venue: Venue.optional(), sort: z.enum(["return_30d", "forks", "new"]).default("return_30d") });
export const PublicStrategiesRes = Page(PublicStrategySummary);
export const PublicStrategyDetail = PublicStrategySummary.extend({ thesis: z.string(), strategy: Strategy, humanized: Humanized, nodes: z.array(StrategyNode), forkedFrom: StrategyId.nullable() });
export const PublishReq = z.object({ public: z.boolean() });

// ---------- Traders leaderboard ----------
export const LeaderboardQuery = z.object({ window: z.enum(["7d", "30d", "all"]).default("30d") });
export const Trader = z.object({
  rank: z.number().int().min(1), handle: z.string(), isYou: z.boolean(), venues: z.array(Venue),
  paperReturnPct: Decimal.nullable(), winRatePct: Decimal.nullable(), strategies: z.number().int().min(0), spark: z.array(z.number()),
});
export const LeaderboardRes = z.object({ window: z.enum(["7d", "30d", "all"]), basis: z.literal("paper"), items: z.array(Trader), asOf: IsoTime, mock: z.boolean(), notice: z.string() });

// ---------- Rewards (MOCK / example only) ----------
export const Quest = z.object({ id: z.string(), title: z.string(), done: z.boolean() });
export const RewardsRes = z.object({
  mock: z.literal(true), notice: z.string(),
  /** Always true in M3.1: every number below is EXAMPLE data for UI layout, not a live program. */
  example: z.literal(true),
  points: z.number().int(), season: z.object({ id: z.string(), name: z.string(), startsAt: IsoTime, endsAt: IsoTime }), rank: z.number().int(), totalParticipants: z.number().int(),
  quests: z.array(Quest.extend({ points: z.number().int(), progress: z.number().min(0).max(1) })),
  history: z.array(z.object({ at: IsoTime, points: z.number().int(), reason: z.string() })),
});

// ---------- Revenue (MOCK / example only) ----------
export const RevenueRow = z.object({ strategyId: StrategyId, name: z.string(), forks: z.number().int(), followersVolumeUsd: Decimal, earnedUsd: Decimal });
export const RevenueRes = z.object({
  mock: z.literal(true), notice: z.string(),
  earnedUsd: Decimal, claimableUsd: Decimal, forks: z.number().int(), creatorSharePct: Decimal.nullable(), // null = to be confirmed
  rows: z.array(RevenueRow), claimEnabled: z.literal(false),
  /** M5.22: "paper_ledger" = followersVolumeUsd/earnedUsd are accrued from real paper fills of other users' copies/forks
   *  (REVENUE_ACCOUNTING_ENABLED + CREATOR_SHARE_BPS). Still paper: nothing is paid or claimable. "off" = zeros as before. */
  accounting: z.enum(["off", "paper_ledger"]).default("off"),
});

// ---------- Skills ----------
export const Skill = z.object({
  id: z.string(), name: z.string(), by: z.string(), desc: z.string(), venues: z.array(Venue), blocks: z.number().int().min(1),
  /** Prompt the builder sends to /compile to apply this skill. */
  prompt: z.string(),
});
export const SkillsRes = z.object({ items: z.array(Skill) });

// =====================================================================================================
// v1.2 (M3.8): backend for Weft-style sections the web still mocked. Paper / read-only only. Additive.
// =====================================================================================================

// ---------- Landing (guest, no auth): GET /v1/public/landing ----------
/** "What it trades" row. status = what Quiver does on that venue today (never "live" in v1). */
export const LandingTrade = z.object({ id: z.string(), label: z.string(), venues: z.array(Venue), example: z.string(), status: z.enum(["paper", "watch_only"]) });
/** "What it can watch" tile. supported=false means the landing copy names it but no v1 signal kind backs it yet. */
export const LandingSignal = z.object({ id: z.string(), label: z.string(), detail: z.string(), supported: z.boolean(), signalKinds: z.array(z.string()), note: z.string().nullable() });
export const LandingPreviewEvent = z.object({ ts: IsoTime, type: z.enum(["fired", "fill"]), message: z.string() });
/** "Paper preview" card: a 7-day paper backtest of one seed strategy. synthetic=true in mock price mode. */
export const LandingPreview = z.object({
  strategyId: StrategyId, name: z.string(), author: Author /* M3.9: same as featured */, from: IsoTime, to: IsoTime,
  startingEquityUsd: Decimal, equityUsd: Decimal, pnlUsd: Decimal, pnlPct: Decimal, trades: z.number().int().min(0),
  points: z.array(z.number()), events: z.array(LandingPreviewEvent).max(10), synthetic: z.boolean(),
});
export const LandingVenue = z.object({ id: Venue, name: z.string(), status: z.enum(["up", "degraded", "down"]), capabilities: z.array(z.enum(["read", "paper", "testnet", "live"])), note: z.string().nullable() });
export const LandingRes = z.object({
  mode: z.enum(["mock", "testnet", "mainnet"]), venues: z.array(LandingVenue), trades: z.array(LandingTrade), signals: z.array(LandingSignal),
  skills: z.array(Skill), featured: z.array(PublicStrategySummary).max(6), preview: LandingPreview.nullable(),
  asOf: IsoTime, mock: z.boolean(), notice: z.string(),
});

// ---------- Settings (auth): GET /v1/settings ----------
export const AccountSettingsRes = z.object({
  limits: z.object({ maxActiveRuns: z.number().int(), maxEventStreams: z.number().int(), compilesPerDay: z.number().int(), maxStrategySignals: z.number().int() }),
  usage: z.object({ activeRuns: z.number().int().min(0), strategies: z.number().int().min(0), compilesUsedToday: z.number().int().min(0) }),
  sessionKeyDefaults: z.object({ perTradeCapUsd: z.number(), dailyCapUsd: z.number(), minSwapUsd: z.number(), maxSlippagePct: z.number() }),
  trading: z.object({ enabledModes: z.array(z.enum(["paper", "testnet", "live"])), liveEnabled: z.literal(false), killSwitch: z.boolean() }),
  /** Alerts/notifications need a delivery provider the operator has not chosen; always configured=false in v1. */
  alerts: z.object({ configured: z.literal(false), channels: z.array(z.enum(["email", "telegram", "webhook"])).max(0), note: z.string() }),
  asOf: IsoTime,
});

// ---------- Stop all (auth): POST /v1/runs/stop-all ----------
export const StopAllReq = z.object({ flatten: z.boolean().default(false), mode: z.enum(["paper", "testnet"]).optional() });
export const StopAllRes = z.object({ stopped: z.array(RunId), alreadyStopped: z.number().int().min(0) });

// ---------- Run result card (auth): GET /v1/runs/:id/card ----------
export const RunCard = z.object({
  runId: RunId, strategyId: StrategyId, name: z.string(), mode: z.enum(["paper", "testnet", "live"]), status: z.enum(["starting", "running", "paused", "stopped", "halted"]),
  venues: z.array(Venue), startedAt: IsoTime, stoppedAt: IsoTime.nullable(), durationSec: z.number().int().min(0),
  startingEquityUsd: Decimal, equityUsd: Decimal, pnlUsd: Decimal, pnlPct: Decimal, maxDrawdownPct: Decimal,
  fills: z.number().int().min(0), triggerFires: z.number().int().min(0), feesUsd: Decimal,
  spark: z.array(z.number()), synthetic: z.boolean(), disclaimer: z.string(),
});
