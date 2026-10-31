import { StrategyRecord } from "@/lib/contracts";
import type { StrategyRecord as RecordData } from "@/lib/api/types";

export async function readOnlineDrafts(db: D1Database, owner: string) {
  const rows = await db.prepare("SELECT record FROM preview_drafts WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50").bind(owner).all<{ record: string }>();
  return rows.results.map((r) => StrategyRecord.parse(JSON.parse(r.record)));
}
export async function writeOnlineDraft(db: D1Database, owner: string, record: RecordData, insertOnly = false) {
  const result = await db.prepare(`INSERT INTO preview_drafts (owner_id, id, record, updated_at)
    SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM preview_drafts WHERE owner_id = ?) < 50
    OR EXISTS (SELECT 1 FROM preview_drafts WHERE owner_id = ? AND id = ?)
    ON CONFLICT(owner_id, id) ${insertOnly ? "DO NOTHING" : "DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at"}`)
    .bind(owner, record.id, JSON.stringify(record), record.updatedAt, owner, owner, record.id).run();
  return result.meta.changes > 0;
}
export async function removeOnlineDraft(db: D1Database, owner: string, id: string) {
  await db.prepare("DELETE FROM preview_drafts WHERE owner_id = ? AND id = ?").bind(owner, id).run();
}

export async function replaceOnlineDraft(db: D1Database, owner: string, record: RecordData, expectedVersion: number) {
  const r = await db.prepare("UPDATE preview_drafts SET record = ?, updated_at = ? WHERE owner_id = ? AND id = ? AND json_extract(record, '$.version') = ?")
    .bind(JSON.stringify(record), record.updatedAt, owner, record.id, expectedVersion).run();
  return r.meta.changes === 1;
}
