import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviewBudget } from "../lib/preview/budget";
import { readOnlineDrafts, writeOnlineDraft, removeOnlineDraft } from "../lib/preview/storage";
import { previewRecord } from "../lib/preview/records";
import { draftBackup, parseDraftBackup, draftFingerprint } from "../lib/api/draft-backup";
import { mergePreviewDrafts } from "../lib/api/preview-workspace";
import { STRATEGY_RAW, USER_ID } from "../lib/api/fixtures";
import { budgeted } from "../services/backend/src/compile";
import { GET, POST, DELETE } from "../app/api/preview/workspace/route";
import { POST as compileImage } from "../app/api/preview/compile-image/route";

// Exercise the actual generated migration and production SQL with SQLite, without network or secrets.
function binding(sqlite: DatabaseSync): D1Database {
  return { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let args: SQLInputValue[] = [];
    return {
      bind(...values: SQLInputValue[]) { args = values; return this; },
      async run() { return { success: true, meta: { changes: Number(statement.run(...args).changes) } }; },
      async all() { return { results: statement.all(...args) }; },
      async first() { return statement.get(...args) ?? null; },
    };
  } } as unknown as D1Database;
}
let checks = 0;
const dir = mkdtempSync(join(tmpdir(), "quiver-site-")), file = join(dir, "data.db");
let sqlite = new DatabaseSync(file), db = binding(sqlite);
try {
  sqlite.exec(readFileSync(new URL("../drizzle/0000_careful_susan_delgado.sql", import.meta.url), "utf8"));
  const a = previewRecord(STRATEGY_RAW, "stg_aaaaaaaaaaaa", USER_ID);
  const b = previewRecord({ ...a.strategy, name: "Another user's private draft" }, a.id, USER_ID);
  assert(await writeOnlineDraft(db, "owner-a", a)); assert(await writeOnlineDraft(db, "owner-b", b));
  assert.equal((await readOnlineDrafts(db, "owner-a"))[0].name, a.name);
  assert.equal((await readOnlineDrafts(db, "owner-b"))[0].name, b.name);
  assert.deepEqual(await readOnlineDrafts(db, "stranger"), []); checks++;
  await removeOnlineDraft(db, "stranger", a.id); assert.equal((await readOnlineDrafts(db, "owner-a")).length, 1); checks++;
  sqlite.close(); sqlite = new DatabaseSync(file); db = binding(sqlite);
  assert.equal((await readOnlineDrafts(db, "owner-a"))[0].id, a.id); checks++;
  for (let i = 0; i < 49; i++) assert(await writeOnlineDraft(db, "owner-a", { ...a, id: `stg_${String(i).padStart(12, "0")}` }));
  assert(!await writeOnlineDraft(db, "owner-a", { ...a, id: "stg_extrarecord12" }));
  assert(await writeOnlineDraft(db, "owner-a", { ...a, name: "Updated" }));
  assert.equal((await readOnlineDrafts(db, "owner-a")).length, 50); checks++;
  await removeOnlineDraft(db, "owner-a", a.id); assert(await writeOnlineDraft(db, "owner-a", { ...a, id: "stg_extrarecord12" })); checks++;

  const now = Date.parse("2026-10-31T12:00:00Z"), options = { capUsd: 0.3, maxInflight: 3, maxOutputTokens: 4000, now: () => now };
  const budgets = Array.from({ length: 10 }, () => createPreviewBudget(db, "ai-a", options));
  const reservations = await Promise.all(budgets.map((v) => v.reserve!()));
  assert.equal(reservations.filter((v) => v !== null).length, 3); checks++;
  await budgets[0].settle!(0.1, 0.002);
  const extra = createPreviewBudget(db, "ai-b", options); assert.equal(await extra.reserve!(), null); // Would total 0.302.
  await budgets[1].settle!(0.1, 0.002); assert.equal(await extra.reserve!(), 0.1); checks++;
  const spend = sqlite.prepare("SELECT SUM(cost_micros) AS total FROM preview_ai_reservations").get()!.total;
  assert.equal(spend, 204000); checks++;
  const crashed = createPreviewBudget(db, "ai-c", { ...options, capUsd: 0.4, now: () => now + 301_000 });
  assert.equal(await crashed.reserve!(), 0.1); // An expired slot frees concurrency, never refunds an uncertain charge.
  assert.equal(sqlite.prepare("SELECT SUM(cost_micros) AS total FROM preview_ai_reservations").get()!.total, 304000); checks++;
  let providerCalls = 0;
  const capped = createPreviewBudget(db, "ai-c", { ...options, capUsd: 0.30, now: () => now + 301_000 });
  assert.equal(await budgeted(capped, async () => { providerCalls++; return { costUsd: 0.001 }; }), null);
  assert.equal(providerCalls, 0); checks++;
  const nextDay = createPreviewBudget(db, "ai-a", { ...options, now: () => now + 86_400_000 });
  await assert.rejects(() => budgeted(nextDay, async () => { throw new Error("provider timeout"); }));
  assert.equal(sqlite.prepare("SELECT cost_micros FROM preview_ai_reservations WHERE day = '2026-11-01'").get()!.cost_micros, 100000); checks++;
  const uncertain = createPreviewBudget(db, "ai-unknown", { ...options, now: () => now + 86_400_000 });
  assert.equal((await budgeted(uncertain, async () => ({ costUsd: NaN })))!.costUsd, 0.1);
  assert.equal(sqlite.prepare("SELECT cost_micros FROM preview_ai_reservations WHERE owner_id = 'ai-unknown'").get()!.cost_micros, 100000); checks++;
  const broken = createPreviewBudget({ prepare: () => { throw new Error("database unavailable"); } } as unknown as D1Database, "ai", options);
  await assert.rejects(() => budgeted(broken, async () => { providerCalls++; return { costUsd: 0.001 }; })); assert.equal(providerCalls, 0); checks++;

  const backup = draftBackup([a]); const parsed = parseDraftBackup(JSON.stringify(backup));
  assert.equal(draftFingerprint(parsed[0].strategy), draftFingerprint(a.strategy));
  assert(!JSON.stringify(backup).includes("ownerId")); assert(!JSON.stringify(backup).includes("activeRunId")); checks++;
  assert.throws(() => parseDraftBackup("{}"));
  assert.throws(() => parseDraftBackup(JSON.stringify({ ...backup, drafts: [...backup.drafts, { ...backup.drafts[0], strategy: { ...a.strategy, actions: [{ ...a.strategy.actions[0], instrument: "hl:perp:UNKNOWN" }] } }] })));
  assert.throws(() => parseDraftBackup("x".repeat(1_000_001))); checks++;
  assert.equal(mergePreviewDrafts([a], [b]).length, 1); assert.equal(mergePreviewDrafts([a], [b])[0].name, b.name); checks++;
  const request = (method = "GET", origin?: string) => new Request("https://quiver.example/api/preview/workspace", { method, headers: origin ? { origin } : {} });
  assert.equal((await GET(request())).status, 200); assert.equal(((await (await GET(request())).json()) as { authenticated: boolean }).authenticated, false);
  assert.equal((await POST(request("POST"))).status, 401); assert.equal((await DELETE(request("DELETE"))).status, 401);
  assert.equal((await POST(request("POST", "https://other.example"))).status, 403);
  assert.equal((await compileImage(request("POST"))).status, 401); checks++;
  console.log(`PASS: ${checks} Site storage checks (user isolation, restart durability, capacity, atomic AI budget, fail-closed billing, portable backup and authorization).`);
} finally { sqlite.close(); rmSync(dir, { recursive: true, force: true }); }
