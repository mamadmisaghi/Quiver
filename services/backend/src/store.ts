import type { z } from "zod";
import type { BacktestRes, Eligibility, SessionKeyPolicy } from "../contracts/src/api";
import type { RunEvent } from "../contracts/src/events";
import type { Humanized, Strategy, ValidationIssue } from "../contracts/src/strategy";

export interface User { bio?: string | null; following?: string[]; /* M5.5 */ id: string; createdAt: number; displayName: string | null; label: string; wallet: string; eligibility: z.infer<typeof Eligibility>; termsVersion: string | null; compiles: { day: string; n: number }; /** M5.2 */ linkedWallets?: { address: string; linkedAt: number }[] }
export interface StrategyVersion { version: number; strategy: Strategy; humanized: z.infer<typeof Humanized>; issues: ValidationIssue[]; createdAt: number }
export interface StrategyRow { copyOf?: { publicStrategyId: string; handle: string; sourceVersion: number; copiedAt: number; syncedAt: number; /** M5.10: set on unfollow; sync is blocked for good */ detachedAt?: number }; /* M5.5 */ id: string; ownerId: string; archived: boolean; versions: StrategyVersion[]; createdAt: number; updatedAt: number; compileId?: string; public?: boolean; publishedAt?: number; forkedFrom?: string | null; forks?: number }
export interface RunRow { id: string; ownerId: string; strategyId: string; strategyVersion: number; mode: "paper" | "testnet" | "live"; status: "starting" | "running" | "paused" | "stopped" | "halted"; startedAt: number; stoppedAt: number | null; startingEquity: number; sessionKeyId?: string; events: RunEvent[]; approvalMode?: "auto" | "confirm_each"; approvalTtlSec?: number }
export interface BacktestRow { id: string; ownerId: string; res: z.infer<typeof BacktestRes>; canceled: boolean; listeners: Set<(e: { type: "progress" | "done"; data: unknown }) => void> }
export interface SessionKeyRow { id: string; ownerId: string; status: "pending" | "active" | "expired" | "revoked"; policy: z.infer<typeof SessionKeyPolicy>; address: string; smartAccount: string; typedData: unknown; createdAt: number; spent: { day: string; usd: number }; revokeTx: string | null; grant?: import("./sessionkeys/service").GrantParams; policyHash?: string; targets?: import("./sessionkeys/service").Target[]; installTx?: string | null }

/** In-memory store for mock mode (ARCHITECTURE §3 tables map 1:1; Postgres adapter lands with testnet persistence). */
export class MemStore {
  llmDaily = new Map<string, { day: string; usd: number; reserved: number; maxCall: number }>();
  /** Completed paper-engine checkpoints; never contains a signing key. */
  runCheckpoints = new Map<string, import("./runs/checkpoint").RunCheckpoint>();
  users = new Map<string, User>(); usersByLabel = new Map<string, string>();
  refresh = new Map<string, { userId: string; exp: number }>();
  strategies = new Map<string, StrategyRow>();
  runs = new Map<string, RunRow>();
  backtests = new Map<string, BacktestRow>();
  sessionKeys = new Map<string, SessionKeyRow>();
  /** M4.5.1: autopilot settings + state per user (persisted with the dev store). */
  autopilot = new Map<string, import("./autopilot/service").ApState>();
  /** M3.6.1: SessionAccount slippageCapBps by lowercase smart-account address (filled by the indexer from setSlippageCap; empty = default 100 bps). */
  /** M4.8: public result-card share tokens (token -> run). Revoked rows are kept for audit. */
  instructs = new Map<string, { id: string; runId: string; ownerId: string; strategyId: string; baseVersion: number; text: string; ops: unknown[]; changes: unknown[]; issues: unknown[]; ok: boolean; compiler: "ai" | "demo"; notice: string | null; status: "proposed" | "applied" | "expired" | "superseded"; createdAt: number; expiresAt: number; appliedAt: number | null; appliedVersion: number | null; strategy: unknown }>();
  replayShares = new Map<string, ReplayShareRow>(); // M5.7
  userSecrets = new Map<string, UserSecretRow>(); // M5.9 (ciphertext only)
  cardShares = new Map<string, { token: string; runId: string; ownerId: string; createdAt: number; revokedAt: number | null }>();
  accountSlippageCapBps = new Map<string, number>();
  idem = new Map<string, { at: number; status: number; body: unknown }>();
  audit: { at: number; userId: string | null; action: string; target?: string; meta?: Record<string, unknown> }[] = [];
}

/** Opaque cursor over newest-first lists: base64url("<createdAt>|<id>"). */
export function paginate<T extends { id: string }>(items: T[], key: (x: T) => number, limit: number, cursor?: string) {
  const sorted = [...items].sort((a, b) => key(b) - key(a) || (a.id < b.id ? 1 : -1));
  let start = 0;
  if (cursor) { try { const [t, id] = Buffer.from(cursor, "base64url").toString().split("|"); const i = sorted.findIndex((x) => x.id === id && key(x) === Number(t)); start = i >= 0 ? i + 1 : sorted.length; } catch { start = sorted.length; } }
  const page = sorted.slice(start, start + limit);
  const last = page.at(-1);
  return { items: page, nextCursor: start + limit < sorted.length && last ? Buffer.from(`${key(last)}|${last.id}`).toString("base64url") : null };
}

/** M5.7: frozen replay snapshot + render job state. */
export interface ReplayShareRow { token: string; runId: string; ownerId: string; title: string; createdAt: number; revokedAt: number | null; replay: Record<string, unknown> & { digest: string; totalFrames: number };
  render: { status: "none" | "queued" | "rendering" | "done" | "failed" | "not_configured"; jobId: string | null; renderer: string; spec: { aspect: "9:16" | "16:9" | "1:1"; fps: 24 | 30; durationSec: number; width: number; height: number; totalFrames: number } | null; requestedAt: number | null; finishedAt: number | null; videoUrl: string | null; posterUrl: string | null; error: string | null } }

/** M5.9: `sealed` is AES-256-GCM ciphertext (see src/secrets/vault.ts); plaintext is never stored. */
export interface UserSecretRow { id: string; ownerId: string; kind: "rpc" | "ai_key"; chainId: number | null; provider: string | null; label: string; hint: string; sealed: string; createdAt: number; updatedAt: number; lastUsedAt: number | null }
