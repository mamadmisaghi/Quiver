import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createLedger,
  restoreLedger,
  serializeLedger,
  transition,
  type Allocation,
  type Amount,
  type Execution,
  type FinalReport,
  type JournalEvent,
  type Ledger,
  type Plan,
} from "../../src/execution/ledger";

const money = (asset: string, units: string): Amount => ({ asset, units });
const cash = (units: string) => money("USDC", units);
const token = (asset: string, units: string) => money(asset, units);
const allocations: Allocation[] = [
  { venue: "Solana", asset: "USDC", units: "1000" },
  { venue: "Solana", asset: "SOL_GAS", units: "5" },
  { venue: "Hyperliquid", asset: "USDC", units: "300" },
];
const makePlan = (
  id: string,
  instrument: string,
  venue = "Solana",
  max = "150",
  after: string[] = [],
): Plan => ({
  id,
  venue,
  instrument,
  side: venue === "Solana" ? "buy" : "long",
  targetQty: "100",
  termsHash: createHash("sha256")
    .update(venue + ":" + instrument + ":" + id)
    .digest("hex"),
  reserve: [cash(max)],
  after,
});
const filled = (
  id: string,
  fillId: string,
  qty: string,
  debits: Amount[],
  credits: Amount[],
): JournalEvent => ({
  kind: "execution",
  id,
  fill: { fillId, orderRef: "venue-" + id, qty, debits, credits },
});
function final(
  id: string,
  outcome: FinalReport["outcome"],
  qty: string,
  debits: Amount[],
  credits: Amount[],
  ref: string | null = "venue-" + id,
): JournalEvent {
  return {
    kind: "final",
    id,
    report: {
      orderRef: ref,
      outcome,
      cumulativeQty: qty,
      cumulativeDebits: debits,
      cumulativeCredits: credits,
    },
  };
}
const status = (s: Ledger, id: string) => s.orders.find((o) => o.spec.id === id)!.status;
const acct = (s: Ledger, venue: string, asset: string) =>
  s.accounts.find((a) => a.venue === venue && a.asset === asset)!;
let n = 0;
function invariants(s: Ledger) {
  for (const a of s.accounts) {
    assert.equal(BigInt(a.free) + BigInt(a.held), BigInt(a.funded) + BigInt(a.credited) - BigInt(a.debited));
    const holds = s.orders
      .filter((o) => o.spec.venue === a.venue)
      .flatMap((o) => o.remaining)
      .filter((x) => x.asset === a.asset);
    assert.equal(
      BigInt(a.held),
      holds.reduce((sum, v) => sum + BigInt(v.units), 0n),
    );
    assert(BigInt(a.held) >= 0n);
    if (!s.issues.length) assert(BigInt(a.free) >= 0n);
  }
  assert.equal(s.revision, s.journal.length);
}
function scenario(initial = createLedger("user1:strategy1", allocations)) {
  let s = initial,
    sends = 0;
  function step(e: JournalEvent) {
    const prior = JSON.stringify(s),
      result = transition(s, e);
    assert.equal(prior, JSON.stringify(s), "input ledger mutated");
    assert.equal(result.previousRevision, s.revision);
    const delta = result.next === s ? 0 : 1;
    assert.equal(result.next.revision, s.revision + delta);
    s = result.next;
    if (result.send) sends++;
    invariants(s);
    return result;
  }
  function restart() {
    const round = restoreLedger(serializeLedger(s));
    assert.deepEqual(round, s);
    s = round;
    invariants(s);
  }
  function approve(id: string, until = 100) {
    return step({ kind: "approve", id, approvalRef: "grant-" + id, expiresAt: until, now: 1 });
  }
  function begin(id: string) {
    return step({ kind: "submit", id, now: 2 });
  }
  function place(spec: Plan) {
    step({ kind: "plan", spec });
    approve(spec.id);
    begin(spec.id);
  }
  return {
    get state() {
      return s;
    },
    get sends() {
      return sends;
    },
    step,
    restart,
    approve,
    begin,
    place,
  };
}
function pass(label: string) {
  n++;
  console.log("PASS " + label);
}

{
  const h = scenario();
  for (const s of [
    makePlan("n", "NEET"),
    makePlan("t", "TROLL"),
    makePlan("s", "SOL"),
    makePlan("b", "BTC", "Hyperliquid", "200", ["n", "t", "s"]),
    { ...makePlan("x", "XMR", "Hyperliquid", "101", ["n", "t", "s"]), side: "short" as const },
  ])
    h.step({ kind: "plan", spec: s });
  for (const id of ["n", "t", "s"]) {
    h.approve(id);
    h.begin(id);
  }
  assert.equal(acct(h.state, "Solana", "USDC").free, "550");
  assert.equal(acct(h.state, "Hyperliquid", "USDC").free, "300");
  for (const [id, asset] of [
    ["n", "NEET"],
    ["t", "TROLL"],
  ]) {
    const e = filled(id, "trade-1", "100", [cash("105")], [token(asset, "100")]);
    h.step(e);
    assert.equal(status(h.state, id), "awaiting_final");
    assert.throws(() => h.approve("b"), /predecessor/);
    h.step(final(id, "filled", "100", [cash("105")], [token(asset, "100")]));
    const saved = h.state;
    h.step(e);
    assert.equal(h.state, saved);
  }
  const half = filled("s", "part-1", "50", [cash("50")], [token("SOL", "50")]);
  h.step(half);
  assert.equal(status(h.state, "s"), "partial");
  assert.equal(acct(h.state, "Solana", "USDC").held, "100");
  h.restart();
  h.step(half);
  assert.throws(() => h.approve("b"), /predecessor/);
  assert.equal(h.sends, 3);
  const premature = final("s", "filled", "100", [cash("111")], [token("SOL", "100")]);
  h.step(premature);
  assert.equal(status(h.state, "s"), "reconciling");
  assert.throws(() => h.approve("x"), /predecessor/);
  h.restart();
  const receiptsBefore = h.state.orders.find((o) => o.spec.id === "s")!.executions.length;
  h.step(premature);
  assert.equal(h.state.orders.find((o) => o.spec.id === "s")!.executions.length, receiptsBefore);
  h.step(filled("s", "part-2", "50", [cash("61")], [token("SOL", "50")]));
  assert.equal(status(h.state, "s"), "filled");
  assert.equal(acct(h.state, "Solana", "USDC").free, "679");
  assert.equal(acct(h.state, "Solana", "USDC").held, "0");
  h.approve("b");
  assert.throws(() => h.approve("x"), /Insufficient funds on this venue/);
  assert.equal(h.begin("b").send?.clientOrderId, "user1:strategy1~b");
  h.step(final("b", "rejected", "0", [], [], null));
  h.approve("x");
  h.begin("x");
  assert.equal(h.sends, 5);
  h.restart();
  pass(
    "all three full, corroborated confirmations gate both follow-on orders; partial/replayed entries never advance the gate; no cross-venue funding",
  );
}
{
  const h = scenario();
  h.place(makePlan("lost", "NEET"));
  h.step({ kind: "unknown", id: "lost" });
  h.restart();
  assert.equal(status(h.state, "lost"), "unknown");
  assert.equal(h.begin("lost").send, undefined);
  assert.equal(acct(h.state, "Solana", "USDC").held, "150");
  h.step({ kind: "revoke", id: "lost" });
  assert.equal(acct(h.state, "Solana", "USDC").held, "150");
  h.step({ kind: "accepted", id: "lost", orderRef: "venue-lost" });
  h.step({ kind: "unknown", id: "lost" });
  assert.equal(status(h.state, "lost"), "submitted");
  h.step(filled("lost", "fill1", "25", [cash("25")], [token("NEET", "25")]));
  h.step(final("lost", "cancelled", "25", [cash("25")], [token("NEET", "25")]));
  assert.equal(acct(h.state, "Solana", "USDC").free, "975");
  assert.equal(acct(h.state, "Solana", "USDC").held, "0");
  assert.equal(status(h.state, "lost"), "cancelled");
  h.restart();
  pass(
    "lost replies retain funds; resume emits no second send; revoke of a pending order keeps its reservation until authoritative partial cancellation",
  );
}
{
  const h = scenario();
  h.place({ ...makePlan("fee", "SOL"), reserve: [cash("150"), token("SOL_GAS", "1")] });
  h.step(final("fee", "rejected", "0", [token("SOL_GAS", "1")], []));
  assert.equal(status(h.state, "fee"), "reconciling");
  assert.equal(acct(h.state, "Solana", "USDC").held, "150");
  h.step(filled("fee", "txfee", "0", [token("SOL_GAS", "1")], []));
  assert.equal(status(h.state, "fee"), "rejected");
  assert.equal(acct(h.state, "Solana", "USDC").free, "1000");
  assert.equal(acct(h.state, "Solana", "SOL_GAS").free, "4");
  h.restart();
  pass(
    "a rejected transaction's authenticated native gas debit is settled separately from released quote funds",
  );
}
{
  const h = scenario();
  h.step({ kind: "plan", spec: makePlan("exp", "SOL") });
  h.approve("exp", 2);
  assert.throws(() => h.begin("exp"), /authorized/);
  assert.throws(
    () => h.step({ kind: "plan", spec: { ...makePlan("exp", "SOL"), termsHash: "a".repeat(64) } }),
    /different plan/,
  );
  assert.throws(() => h.step({ kind: "plan", spec: makePlan("exp", "FAKE") }), /different plan/);
  assert.throws(
    () => h.step({ kind: "plan", spec: makePlan("z", "Z", "Solana", "10", ["nope"]) }),
    /predecessor/,
  );
  h.step({ kind: "revoke", id: "exp" });
  assert.equal(acct(h.state, "Solana", "USDC").free, "1000");
  assert.throws(() => h.begin("exp"), /authorized/);
  pass("fresh approvals, expiry, immutable intents, dependency identities and pre-submission revocation");
}
{
  const h = scenario();
  h.place(makePlan("o", "SOL"));
  h.step(filled("o", "dup", "9", [cash("7")], [token("SOL", "9")]));
  const stable = acct(h.state, "Solana", "USDC").debited;
  h.step(filled("o", "dup", "10", [cash("8")], [token("SOL", "9")]));
  assert.equal(acct(h.state, "Solana", "USDC").debited, stable);
  assert(h.state.issues.length);
  h.step({ kind: "plan", spec: makePlan("other", "DOG") });
  assert.throws(() => h.approve("other"), /Cannot approve/);
  h.restart();
  assert.equal(h.sends, 1);
  pass("conflicting repeated venue evidence freezes new submissions without double spending");
}
{
  const h = scenario();
  h.place(makePlan("a", "SOL"));
  h.place(makePlan("b", "DOG"));
  h.step({ kind: "accepted", id: "a", orderRef: "exchange-101" });
  h.step({ kind: "accepted", id: "b", orderRef: "exchange-101" });
  assert(h.state.issues.some((x) => x.id === "b"));
  assert.equal(h.state.orders[1].orderRef, null);
  h.restart();
  pass("one venue order reference cannot bind to two approved intents");
}
{
  const h = scenario();
  h.place(makePlan("over", "SOL", "Solana", "5"));
  h.step(filled("over", "real", "105", [cash("1001")], [token("SOL", "105")]));
  assert.equal(acct(h.state, "Solana", "USDC").free, "-1");
  assert.equal(acct(h.state, "Solana", "USDC").debited, "1001");
  assert(h.state.issues.some((x) => x.reason.includes("quantity")));
  assert(h.state.issues.some((x) => x.reason.includes("debit")));
  assert.equal(status(h.state, "over"), "reconciling");
  h.restart();
  pass(
    "an authenticated excess fill is booked in exact units and quarantines the account instead of hiding the exposure",
  );
}
{
  const n = "900719925474099312345678";
  const h = scenario(createLedger("long", [{ venue: "Solana", asset: "USDC", units: n }]));
  h.place(makePlan("tiny", "SOL", "Solana", n));
  const cost = (BigInt(n) - 1n).toString();
  const receipt = filled("tiny", "huge", "100", [cash(cost)], [token("SOL", "100")]);
  h.step(receipt);
  h.step(final("tiny", "filled", "100", [cash(cost)], [token("SOL", "100")]));
  h.step(receipt);
  assert.equal(acct(h.state, "Solana", "USDC").free, "1");
  h.restart();
  pass("quantities above Number.MAX_SAFE_INTEGER and one-unit residue survive JSON persistence exactly");
}
{
  const h = scenario();
  h.step({ kind: "plan", spec: makePlan("cas", "SOL") });
  h.approve("cas");
  const left = transition(h.state, { kind: "submit", id: "cas", now: 10 }),
    right = transition(h.state, { kind: "submit", id: "cas", now: 10 });
  let disk = h.state.revision,
    sends = 0;
  function commit(x: typeof left) {
    if (x.previousRevision !== disk) return false;
    disk = x.next.revision;
    if (x.send) sends++;
    return true;
  }
  assert(commit(left));
  assert(!commit(right));
  assert.equal(sends, 1);
  const replay = restoreLedger(serializeLedger(left.next));
  assert.equal(transition(replay, { kind: "submit", id: "cas", now: 11 }).send, undefined);
  const damaged = JSON.parse(serializeLedger(left.next));
  damaged.revision++;
  assert.throws(() => restoreLedger(JSON.stringify(damaged)), /revision/);
  pass("compare-and-swap across concurrent dispatch attempts and restore never duplicate the external send");
}
{
  const h = scenario();
  h.place(makePlan("late", "SOL"));
  h.step(final("late", "rejected", "0", [], [], null));
  h.step(filled("late", "latefill", "1", [cash("1")], [token("SOL", "1")]));
  assert(h.state.issues.some((x) => x.reason.includes("Unseen execution")));
  assert.equal(acct(h.state, "Solana", "USDC").free, "1000");
  assert.throws(
    () => h.step({ kind: "plan", spec: makePlan("decimal", "SOL", "Solana", "0.00001") }),
    /base units/,
  );
  pass(
    "late contradictory fills after final remain in the evidence journal for reconciliation; fractional native-unit input is rejected",
  );
}
console.log(n + " adversarial scenarios passed");
