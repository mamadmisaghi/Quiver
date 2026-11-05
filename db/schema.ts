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

export const previewConnections = sqliteTable("preview_connections", {
  owner: text("owner").notNull(), kind: text("kind").notNull(), id: text("id").notNull(),
  label: text("label").notNull(), hint: text("hint").notNull(), sealed: text("sealed").notNull(),
  created: text("created").notNull(), updated: text("updated").notNull(), used: text("used"),
}, t => [primaryKey({ columns: [t.owner, t.kind] })]);

export const previewAlertDeliveries = sqliteTable("preview_alert_deliveries", {
  owner: text("owner").notNull(), id: text("id").notNull(), created: integer("created").notNull(), record: text("record").notNull(),
}, t => [primaryKey({columns:[t.owner,t.id]}), index("preview_deliveries_by_time").on(t.owner,t.created)]);
