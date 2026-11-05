/**
 * Venue-adapter-neutral reference for one strategy owner's exact, confirmed movement journal.
 * Each asset has one canonical, fixed smallest unit. The caller authenticates venue evidence and
 * grants. Persist a transition with a compare-and-swap on previousRevision BEFORE executing
 * its send effect. A restored submission must be looked up by its original client order ID.
 * Adapters deterministically encode the scoped client order ID into their venue-specific format.
 * Only a definitive venue status may supply "final". "Not found" by itself is not rejection.
 * Each allocation must be uniquely carved out of its venue account; this ledger is not a deposit
 * observer. An adapter binds the digest to account, chain, mode, instrument, route, fees, price,
 * leverage, time-in-force and the immutable signed order instructions before requesting approval.
 */
export type Amount = Readonly<{ asset: string; units: string }>;
export type Allocation = Readonly<{ venue: string; asset: string; units: string }>;
export type Plan = Readonly<{
  id: string;
  venue: string;
  instrument: string;
  side: "buy" | "sell" | "long" | "short";
  targetQty: string;
  termsHash: string;
  reserve: readonly Amount[];
  after: readonly string[];
}>;
export type Execution = Readonly<{
  fillId: string;
  orderRef: string;
  qty: string;
  debits: readonly Amount[];
  credits: readonly Amount[];
}>;
export type FinalReport = Readonly<{
  orderRef: string | null;
  outcome: "filled" | "cancelled" | "rejected";
  cumulativeQty: string;
  cumulativeDebits: readonly Amount[];
  cumulativeCredits: readonly Amount[];
}>;
export type JournalEvent =
  | { kind: "plan"; spec: Plan }
  | { kind: "approve"; id: string; approvalRef: string; expiresAt: number; now: number }
  | { kind: "submit"; id: string; now: number }
  | { kind: "accepted"; id: string; orderRef: string }
  | { kind: "unknown"; id: string }
  | { kind: "revoke"; id: string }
  | { kind: "execution"; id: string; fill: Execution }
  | { kind: "final"; id: string; report: FinalReport };

export type OrderStatus =
  | "planned"
  | "reserved"
  | "dispatching"
  | "unknown"
  | "submitted"
  | "partial"
  | "awaiting_final"
  | "reconciling"
  | "filled"
  | "cancelled"
  | "rejected"
  | "revoked";
export type Balance = {
  venue: string;
  asset: string;
  funded: string;
  free: string;
  held: string;
  debited: string;
  credited: string;
};
export type Order = {
  spec: Plan;
  status: OrderStatus;
  approval: { ref: string; expiresAt: number } | null;
  revoked: boolean;
  dispatched: boolean;
  orderRef: string | null;
  filledQty: string;
  remaining: Amount[];
  debits: Amount[];
  credits: Amount[];
  executions: Execution[];
  finalReport: FinalReport | null;
};
export type Ledger = {
  v: 1;
  scope: string;
  revision: number;
  genesis: Allocation[];
  accounts: Balance[];
  orders: Order[];
  /** Irreconcilable evidence freezes fresh dispatches until operator/venue reconciliation. */
  issues: { id: string; reason: string }[];
  journal: JournalEvent[];
};
export type Transition = {
  previousRevision: number;
  next: Ledger;
  /** Only a newly recorded submit produces this. No restore/retry path emits it. */
  send?: { scope: string; clientOrderId: string; venue: string; termsHash: string };
};

const identifier = (s: unknown): string => {
  if (typeof s !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(s))
    throw Error("Invalid identifier");
  return s;
};
function units(s: unknown, positive = false): bigint {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(s) || (positive && s === "0"))
    throw Error("Invalid base units");
  return BigInt(s);
}
function clock(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid clock");
  return n;
}
function amounts(values: readonly Amount[]): Amount[] {
  if (!Array.isArray(values) || values.length > 64) throw Error("Invalid quantity vector");
  const copy = values.map((v) => ({ asset: identifier(v.asset), units: units(v.units, true).toString() }));
  copy.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  if (copy.some((v, i) => i > 0 && v.asset === copy[i - 1].asset)) throw Error("Duplicate asset");
  return copy;
}
function get(values: readonly Amount[], asset: string) {
  return BigInt(values.find((v) => v.asset === asset)?.units ?? "0");
}
function withAmount(values: readonly Amount[], asset: string, n: bigint): Amount[] {
  const rest = values.filter((v) => v.asset !== asset);
  if (n < 0n) throw Error("Negative asset amount");
  if (n > 0n) rest.push({ asset, units: n.toString() });
  return rest.sort((a, b) => (a.asset < b.asset ? -1 : 1));
}
function account(s: Ledger, venue: string, asset: string) {
  let a = s.accounts.find((v) => v.venue === venue && v.asset === asset);
  if (!a) {
    a = { venue, asset, funded: "0", free: "0", held: "0", debited: "0", credited: "0" };
    s.accounts.push(a);
  }
  return a;
}
export function createLedger(scope: string, allocations: readonly Allocation[]): Ledger {
  identifier(scope);
  if (!Array.isArray(allocations) || allocations.length > 1024) throw Error("Invalid allocations");
  const s: Ledger = {
    v: 1,
    scope,
    revision: 0,
    genesis: [],
    accounts: [],
    orders: [],
    issues: [],
    journal: [],
  };
  for (const allocation of allocations) {
    const fund = {
      venue: identifier(allocation.venue),
      asset: identifier(allocation.asset),
      units: units(allocation.units, true).toString(),
    };
    const a = account(s, fund.venue, fund.asset);
    if (a.funded !== "0") throw Error("Duplicate venue allocation");
    a.funded = fund.units;
    a.free = fund.units;
    s.genesis.push(fund);
  }
  return s;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const terminal = (o: Order) => ["filled", "rejected", "cancelled", "revoked"].includes(o.status);
function issue(s: Ledger, o: Order, reason: string) {
  if (s.issues.some((x) => x.id === o.spec.id && x.reason === reason)) return false;
  s.issues.push({ id: o.spec.id, reason });
  return true;
}
function release(s: Ledger, o: Order) {
  for (const h of o.remaining) {
    const a = account(s, o.spec.venue, h.asset),
      n = BigInt(h.units);
    a.held = (BigInt(a.held) - n).toString();
    a.free = (BigInt(a.free) + n).toString();
  }
  o.remaining = [];
}
function canonicalPlan(raw: Plan): Plan {
  const id = identifier(raw.id),
    venue = identifier(raw.venue),
    instrument = identifier(raw.instrument);
  if (!["buy", "sell", "long", "short"].includes(raw.side)) throw Error("Invalid side");
  if (typeof raw.termsHash !== "string" || !/^[0-9a-f]{64}$/.test(raw.termsHash))
    throw Error("Invalid execution terms digest");
  if (!Array.isArray(raw.after)) throw Error("Expected predecessor intent IDs");
  const after = [...raw.after].map(identifier).sort(),
    reserve = amounts(raw.reserve);
  if (after.includes(id) || new Set(after).size !== after.length || after.length > 64 || !reserve.length)
    throw Error("Invalid order plan");
  return {
    id,
    venue,
    instrument,
    side: raw.side,
    termsHash: raw.termsHash,
    targetQty: units(raw.targetQty, true).toString(),
    reserve,
    after,
  };
}
function canonicalFill(f: Execution): Execution {
  const qty = units(f.qty).toString(),
    debits = amounts(f.debits),
    credits = amounts(f.credits);
  if (qty === "0" && !(debits.length || credits.length)) throw Error("Empty receipt");
  return { fillId: identifier(f.fillId), orderRef: identifier(f.orderRef), qty, debits, credits };
}
function canonicalFinal(r: FinalReport): FinalReport {
  if (!["filled", "cancelled", "rejected"].includes(r.outcome)) throw Error("Invalid final status");
  if (r.orderRef == null && r.outcome !== "rejected") throw Error("Venue order reference required");
  return {
    orderRef: r.orderRef === null ? null : identifier(r.orderRef),
    outcome: r.outcome,
    cumulativeQty: units(r.cumulativeQty).toString(),
    cumulativeDebits: amounts(r.cumulativeDebits),
    cumulativeCredits: amounts(r.cumulativeCredits),
  };
}
function canBind(s: Ledger, o: Order, ref: string) {
  return (
    (!o.orderRef || o.orderRef === ref) &&
    !s.orders.some((v) => v !== o && v.spec.venue === o.spec.venue && v.orderRef === ref)
  );
}
function closeIfProven(s: Ledger, o: Order) {
  const f = o.finalReport;
  if (!f) return;
  if (s.issues.some((x) => x.id === o.spec.id)) {
    o.status = "reconciling";
    return;
  }
  const qty = BigInt(o.filledQty),
    total = BigInt(f.cumulativeQty);
  const beyond = (a: readonly Amount[], b: readonly Amount[]) =>
    a.some((v) => BigInt(v.units) > get(b, v.asset));
  if (
    qty > total ||
    total > BigInt(o.spec.targetQty) ||
    beyond(o.debits, f.cumulativeDebits) ||
    beyond(o.credits, f.cumulativeCredits) ||
    (f.outcome === "filled" && total !== BigInt(o.spec.targetQty)) ||
    (f.outcome === "rejected" && total !== 0n) ||
    (f.outcome === "cancelled" && total === BigInt(o.spec.targetQty))
  ) {
    issue(s, o, "Terminal report contradicts plan or confirmed movements");
    o.status = "reconciling";
    return;
  }
  // A cumulative event may arrive before one or more individual receipts. Never spend/release twice.
  if (qty !== total || !equal(o.debits, f.cumulativeDebits) || !equal(o.credits, f.cumulativeCredits)) {
    o.status = "reconciling";
    return;
  }
  release(s, o);
  o.status = f.outcome;
}
function apply(s: Ledger, e: JournalEvent): { changed: boolean; send?: Transition["send"] } {
  if (e.kind === "plan") {
    const spec = canonicalPlan(e.spec),
      existing = s.orders.find((o) => o.spec.id === spec.id);
    if (existing) {
      if (!equal(existing.spec, spec)) throw Error("Intent ID reused for a different plan");
      return { changed: false };
    }
    if (spec.after.some((id) => !s.orders.some((o) => o.spec.id === id)))
      throw Error("Register predecessor intents first");
    s.orders.push({
      spec,
      status: "planned",
      approval: null,
      revoked: false,
      dispatched: false,
      orderRef: null,
      filledQty: "0",
      remaining: [],
      debits: [],
      credits: [],
      executions: [],
      finalReport: null,
    });
    return { changed: true };
  }
  const o = s.orders.find((v) => v.spec.id === identifier(e.id));
  if (!o) throw Error("Unknown intent");
  if (e.kind === "approve") {
    const ref = identifier(e.approvalRef),
      until = clock(e.expiresAt),
      now = clock(e.now);
    if (o.approval) {
      if (o.approval.ref === ref && o.approval.expiresAt === until) return { changed: false };
      throw Error("Existing approval differs");
    }
    if (o.status !== "planned" || o.revoked || s.issues.length || until <= now) throw Error("Cannot approve");
    if (o.spec.after.some((id) => s.orders.find((v) => v.spec.id === id)?.status !== "filled"))
      throw Error("Waiting for full predecessor confirmations");
    if (o.spec.reserve.some((h) => BigInt(account(s, o.spec.venue, h.asset).free) < BigInt(h.units)))
      throw Error("Insufficient funds on this venue");
    for (const h of o.spec.reserve) {
      const a = account(s, o.spec.venue, h.asset),
        n = BigInt(h.units);
      a.free = (BigInt(a.free) - n).toString();
      a.held = (BigInt(a.held) + n).toString();
    }
    o.approval = { ref, expiresAt: until };
    o.remaining = [...o.spec.reserve];
    o.status = "reserved";
    return { changed: true };
  }
  if (e.kind === "submit") {
    const now = clock(e.now);
    if (o.dispatched) return { changed: false };
    if (s.issues.length || o.revoked || o.status !== "reserved" || !o.approval || now >= o.approval.expiresAt)
      throw Error("Submission is not authorized");
    o.dispatched = true;
    o.status = "dispatching";
    return {
      changed: true,
      send: {
        scope: s.scope,
        clientOrderId: s.scope + "~" + o.spec.id,
        venue: o.spec.venue,
        termsHash: o.spec.termsHash,
      },
    };
  }
  if (e.kind === "revoke") {
    if (o.revoked || terminal(o)) return { changed: false };
    o.revoked = true;
    if (!o.dispatched) {
      release(s, o);
      o.status = "revoked";
    }
    return { changed: true };
  }
  if (!o.dispatched) throw Error("No durable dispatch for this intent");
  if (e.kind === "unknown") {
    if (o.status !== "dispatching") return { changed: false };
    o.status = "unknown";
    return { changed: true };
  }
  if (e.kind === "accepted") {
    const ref = identifier(e.orderRef);
    if (!canBind(s, o, ref)) return { changed: issue(s, o, "Venue order reference conflict") };
    if (o.orderRef === ref) return { changed: false };
    if (terminal(o)) return { changed: issue(s, o, "Late acceptance contradicts final evidence") };
    o.orderRef = ref;
    if (["unknown", "dispatching"].includes(o.status)) o.status = "submitted";
    return { changed: true };
  }
  if (e.kind === "execution") {
    const f = canonicalFill(e.fill),
      previous = o.executions.find((x) => x.fillId === f.fillId);
    if (previous)
      return {
        changed: equal(f, previous) ? false : issue(s, o, "Conflicting execution identity " + f.fillId),
      };
    if (!canBind(s, o, f.orderRef))
      return { changed: issue(s, o, "Execution belongs to another venue order") };
    if (terminal(o)) return { changed: issue(s, o, "Unseen execution after final " + f.fillId) };
    o.orderRef = f.orderRef;
    for (const d of f.debits) {
      const a = account(s, o.spec.venue, d.asset),
        value = BigInt(d.units),
        hold = get(o.remaining, d.asset),
        consumed = value > hold ? hold : value;
      if (value > hold) issue(s, o, "Confirmed debit exceeded reserved " + d.asset);
      a.held = (BigInt(a.held) - consumed).toString();
      a.free = (BigInt(a.free) - (value - consumed)).toString();
      a.debited = (BigInt(a.debited) + value).toString();
      o.remaining = withAmount(o.remaining, d.asset, hold - consumed);
      o.debits = withAmount(o.debits, d.asset, get(o.debits, d.asset) + value);
    }
    for (const c of f.credits) {
      const a = account(s, o.spec.venue, c.asset),
        value = BigInt(c.units);
      a.free = (BigInt(a.free) + value).toString();
      a.credited = (BigInt(a.credited) + value).toString();
      o.credits = withAmount(o.credits, c.asset, get(o.credits, c.asset) + value);
    }
    o.executions.push(f);
    o.filledQty = (BigInt(o.filledQty) + BigInt(f.qty)).toString();
    if (BigInt(o.filledQty) > BigInt(o.spec.targetQty))
      issue(s, o, "Confirmed quantity exceeds order quantity");
    o.status = s.issues.some((x) => x.id === o.spec.id)
      ? "reconciling"
      : o.filledQty === o.spec.targetQty
        ? "awaiting_final"
        : o.filledQty === "0"
          ? "submitted"
          : "partial";
    closeIfProven(s, o);
    return { changed: true };
  }
  if (e.kind === "final") {
    const f = canonicalFinal(e.report);
    if (o.finalReport)
      return { changed: equal(f, o.finalReport) ? false : issue(s, o, "Conflicting final reconciliation") };
    if ((f.orderRef && !canBind(s, o, f.orderRef)) || (!f.orderRef && o.orderRef))
      return { changed: issue(s, o, "Final report order reference conflict") };
    o.orderRef = f.orderRef;
    o.finalReport = f;
    closeIfProven(s, o);
    return { changed: true };
  }
  throw Error("Unknown event");
}
export function transition(prev: Ledger, event: JournalEvent): Transition {
  const next = structuredClone(prev),
    input = structuredClone(event);
  const result = apply(next, input);
  if (!result.changed) return { previousRevision: prev.revision, next: prev };
  next.journal.push(input);
  next.revision++;
  return { previousRevision: prev.revision, next, ...(result.send ? { send: result.send } : {}) };
}
/** The immutable journal is the authority. No persisted balance/projection is trusted during restore. */
export function serializeLedger(s: Ledger): string {
  return JSON.stringify({
    v: 1,
    scope: s.scope,
    genesis: s.genesis,
    revision: s.revision,
    journal: s.journal,
  });
}
export function restoreLedger(json: string): Ledger {
  const x = JSON.parse(json);
  if (x.v !== 1 || !Array.isArray(x.journal) || x.journal.length !== x.revision)
    throw Error("Invalid ledger format or revision");
  const s = createLedger(x.scope, x.genesis);
  for (const e of x.journal) {
    if (!apply(s, e).changed) throw Error("Journal contains a non-committed duplicate");
    s.journal.push(e);
    s.revision++;
  }
  return s;
}
