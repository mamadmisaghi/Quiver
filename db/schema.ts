import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Temporary Site workspace. Strategies remain portable JSON; the Render engine uses PostgreSQL.
export const previewDrafts = sqliteTable("preview_drafts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  record: text("record").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] })]);

// Never stores prompts, images, credentials or identity tokens. Uncertain charges remain reserved.
export const previewAiReservations = sqliteTable("preview_ai_reservations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), day: text("day").notNull(),
  costMicros: integer("cost_micros").notNull(), status: text("status").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [index("preview_ai_day_owner").on(t.day, t.ownerId)]);
