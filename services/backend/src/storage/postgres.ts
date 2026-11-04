import { PaperSessionSchema } from "../workflows/session";
import { restoreLedger,serializeLedger,transition } from "../execution/ledger";
import { Client } from "pg";
import { snapshot, restore, isValidSnapshot } from "../persist";
import type { MemStore } from "../store";

/** Initial migration. Keep the version gate: an older process must never overwrite a newer format. */
export const MIGRATION = `
CREATE TABLE IF NOT EXISTS quiver_state (
  id text PRIMARY KEY CHECK (id = 'paper-beta'),
  schema_version integer NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

export interface DurableStorage {
  healthy: boolean;
  commit(): Promise<void>;
  close(): Promise<void>;
}
type DatabaseClient = Pick<Client, "connect" | "query" | "end" | "on">;
const EXTRA_MAPS = ["refresh", "idem", "accountSlippageCapBps", "runCheckpoints", "llmDaily"] as const;

export function durableSnapshot(store: MemStore) {
  const data = snapshot(store);
  for (const k of EXTRA_MAPS) data[k] = [...store[k]];
  // Exclude uncommitted events from an operation that is still in flight.
  data.runs = [...store.runs].map(([id, run]) => {
    const cp = store.runCheckpoints.get(id);
    return [id, cp ? { ...run, events: run.events.slice(0, cp.lastSeq + 1) } : run];
  });
  return data;
}
export function restoreDurable(store: MemStore, data: Record<string, unknown>) {
  if (!isValidSnapshot(data)) throw new Error("Unsupported database state format");
  for (const k of EXTRA_MAPS) {
    const rows = data[k];
    if (rows !== undefined && (!Array.isArray(rows) || rows.some((x) => !Array.isArray(x) || x.length !== 2 || typeof x[0] !== "string"))) throw new Error("Invalid database state");
  }
  restore(store, data);
  for(const [id,row] of store.workflowSessions){
    const s=PaperSessionSchema.parse(row.session);
    if(s.id!==id||!row.owner||!row.requestKey||!Number.isSafeInteger(row.serial)||!s.strategy.workflow||!["server","imported"].includes(s.provenance??"")||s.provenance==="server"&&!s.state||s.provenance==="imported"&&s.status!=="completed")throw Error("Invalid hosted workflow checkpoint");
    row.session=s;
  }
  for(const account of store.executionAccounts.values())for(const order of account.orders)order.ledger=restoreLedger(serializeLedger(order.ledger));

  for (const k of EXTRA_MAPS) {
    const map = store[k] as Map<string, unknown>; map.clear();
    for (const [id, value] of (data[k] ?? []) as [string, unknown][]) map.set(id, value);
  }
  if(data.restoreHold===true){
    store.refresh.clear();store.idem.clear();
    for(const [id,h] of store.workflowSessions)if(h.session.status==="running"){
      h.session.status="paused";h.approvals=[];h.trace=[];h.serial++;h.session.controlVersion=(h.session.controlVersion??0)+1;
      store.workflowSessions.set(id,h);
    }
    for(const r of store.runs.values())if(["starting","running"].includes(r.status))r.status="paused";
    for(const a of store.executionAccounts.values()){
      a.paused=true;delete a.challenge;
      if(a.agent){a.agent.sealed="";a.agent.state="disabled";}
      for(const p of a.programs??[]){p.status="stopped";p.pendingReason="Backup restored. Reconcile existing exchange orders before authorizing a new workflow.";}
      for(const o of a.orders)if(!o.ledger.orders[0].dispatched)o.ledger=transition(o.ledger,{kind:"revoke",id:o.terms.id}).next;
    }
  }
}

/**
 * Single-instance paper beta: one atomic PostgreSQL checkpoint for all related records.
 * A session advisory lock and revision CAS prevent a second engine from overwriting state.
 * Render's attached replay disk intentionally uses stop-before-start deployments.
 * This is not a multi-worker/mainnet storage architecture.
 */
export class PostgresPersistence implements DurableStorage {
  healthy = false;
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  beforeCommit: () => Promise<void> = async () => {};
  onFailure: () => void = () => {};
  private constructor(private db: DatabaseClient, private store: MemStore) {}

  static async open(url: string, store: MemStore, client?: DatabaseClient) {
    const db = client ?? new Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 15_000, application_name: "quiver-paper-beta" });
    const p = new PostgresPersistence(db, store);
    db.on("error", () => p.fail());
    try {
      await db.connect();
      const lock = await db.query("SELECT pg_try_advisory_lock(713845, 1) AS acquired");
      if (!lock.rows[0]?.acquired) throw new Error("Another Quiver engine owns this database; run one API instance");
      await db.query(MIGRATION);
      const rows = await db.query("SELECT schema_version, revision, payload FROM quiver_state WHERE id = 'paper-beta'");
      if (rows.rows.length) {
        const row = rows.rows[0];
        if (row.schema_version !== 1) throw new Error("Unsupported Quiver database migration version");
        p.revision = Number(row.revision); restoreDurable(store, row.payload);
      } else {
        await db.query("INSERT INTO quiver_state (id, schema_version, payload) VALUES ('paper-beta', 1, $1::jsonb)", [JSON.stringify(durableSnapshot(store))]);
      }
      p.healthy = true; return p;
    } catch (e) { await db.end().catch(() => {}); throw e; }
  }

  /** Success responses await this commit. A failed commit stops new mutations. */
  commit(): Promise<void> {
    const job = this.tail.then(async () => {
      if (!this.healthy || this.closing) throw new Error("Durable storage unavailable");
      await this.beforeCommit();
      const data = JSON.stringify(durableSnapshot(this.store));
      const r = await this.db.query("UPDATE quiver_state SET payload = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = 'paper-beta' AND schema_version = 1 AND revision = $2 RETURNING revision", [data, this.revision]);
      if (r.rowCount !== 1) throw new Error("Quiver storage revision conflict");
      this.revision = Number(r.rows[0].revision);
    }).catch((e) => { this.fail(); throw e; });
    this.tail = job.catch(() => {}); return job;
  }
  private fail() { if (!this.healthy) return; this.healthy = false; this.onFailure(); }
  async close() { await this.tail; this.closing = true; this.healthy = false; await this.db.end(); }
}
