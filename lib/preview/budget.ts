import type { LlmBudget } from "@/services/backend/src/compile";

export type BudgetOptions = { capUsd: number; maxInflight: number; maxOutputTokens: number; reservationUsd?: number; maxOwnerCalls?: number; publicCapUsd?: number; enforceDailyLimits?: boolean; now?: () => number };
/** A single INSERT/SELECT atomically checks spend and concurrency across Worker isolates. */
export function createPreviewBudget(db: D1Database, owner: string, options: BudgetOptions): LlmBudget {
  const now = options.now ?? Date.now;
  const enforceDailyLimits = options.enforceDailyLimits !== false;
  let reservation: string | null = null, refused: "cap" | "busy" | null = null;
  const estimate = options.reservationUsd ?? 0.10; // Reserve for the selected model; settle against reported cost.
  return {
    capUsd: enforceDailyLimits ? options.capUsd : Number.POSITIVE_INFINITY, maxOutputTokens: options.maxOutputTokens,
    spentToday: () => 0, add: () => {}, refusal: () => refused,
    async reserve() {
      const at = now(), day = new Date(at).toISOString().slice(0, 10), id = crypto.randomUUID();
      const r = await db.prepare(`INSERT INTO preview_ai_reservations (id, owner_id, day, cost_micros, status, created_at)
        SELECT ?, ?, ?, ?, 'pending', ?
        WHERE (? = 0 OR (SELECT COALESCE(SUM(cost_micros), 0) FROM preview_ai_reservations WHERE day = ?) + ? <= ?)
        AND (SELECT COUNT(*) FROM preview_ai_reservations WHERE status = 'pending' AND created_at > ?) < ?
        AND (? = 0 OR (SELECT COUNT(*) FROM preview_ai_reservations WHERE day = ? AND owner_id = ?) < ?)
        AND (? = 0 OR (SELECT COALESCE(SUM(cost_micros), 0) FROM preview_ai_reservations WHERE day = ? AND owner_id LIKE 'anon:%') + ? <= ?)`)
        .bind(id, owner, day, estimate * 1e6, at,
          enforceDailyLimits ? 1 : 0, day, estimate * 1e6, Math.floor(options.capUsd * 1e6),
          at - 300_000, options.maxInflight,
          enforceDailyLimits ? 1 : 0, day, owner, options.maxOwnerCalls ?? 60,
          enforceDailyLimits && owner.startsWith("anon:") ? 1 : 0, day, estimate * 1e6, Math.floor((options.publicCapUsd ?? 1) * 1e6)).run();
      if (!r.meta.changes) {
        const active = await db.prepare("SELECT COUNT(*) AS n FROM preview_ai_reservations WHERE status = 'pending' AND created_at > ?").bind(at - 300_000).first<{ n: number }>();
        refused = (active?.n ?? 0) >= options.maxInflight ? "busy" : "cap";
        return null;
      }
      reservation = id; refused = null; return estimate;
    },
    async settle(_est, actual) {
      if (!reservation) throw new Error("Missing AI reservation");
      await db.prepare("UPDATE preview_ai_reservations SET cost_micros = ?, status = 'settled' WHERE id = ? AND status = 'pending'")
        .bind(Math.ceil((Number.isFinite(actual) && actual >= 0 ? actual : estimate) * 1e6), reservation).run();
      reservation = null;
    },
  };
}
