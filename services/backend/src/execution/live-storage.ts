import { HostError } from "../workflows/host";
import { restoreLedger, serializeLedger, transition } from "./ledger";
import {
  validateLiveRequest,
  type Action,
  type LiveProgram,
  type LiveStore,
  type WalletBudget,
} from "./live-program";

type AccessRow = {
  paused: boolean;
  consent?: { limits: { dailyUsd: number } };
  agent?: { sealed: string; state: string };
};
type Allowance = { state: string; terms: { owner: string; nonce: string } };
type Data = {
  livePrograms: Map<string, LiveProgram>;
  liveAccess: ReadonlyMap<string, AccessRow>;
  liveAllowances: ReadonlyMap<string, Allowance>;
  privySpotGrants: ReadonlyMap<
    string,
    { status: string; sealed: string; revision: number }
  >;
  users: ReadonlyMap<string, unknown>;
  strategies: ReadonlyMap<
    string,
    { ownerId: string; versions: readonly { version: number }[] }
  >;
};
export const liveTerminal = (s: string) =>
  ["filled", "cancelled", "rejected", "revoked"].includes(s);
const walletKey = (b: WalletBudget) =>
  b.network +
  "|" +
  (b.network === "solana-mainnet" ? b.wallet : b.wallet.toLowerCase());

function controlsFunds(p: LiveProgram) {
  if (
    p.status === "running" ||
    p.status === "paused" ||
    p.ledger.orders.some((o) => o.dispatched && !liveTerminal(o.status))
  )
    return true;
  // Perpetual and spot entry quantities live in confirmed credit units. The target of a spot buy is its INPUT amount.
  return Object.values(p.stages).some((s) => {
    const held = s.entries.reduce(
      (n, id) => n + BigInt(p.orders[id].holding?.quantity ?? "0"),
      0n,
    );
    const sold = s.exits.reduce(
      (n, id) =>
        n +
        BigInt(p.ledger.orders.find((o) => o.spec.id === id)?.filledQty ?? "0"),
      0n,
    );
    return held > sold;
  });
}

export function restoreLivePrograms(store: Data, hold: boolean) {
  for (const [id, p] of store.livePrograms) {
    const strategy = store.strategies.get(p.strategyId);
    if (
      p.schema !== 1 ||
      id !== p.id ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 0 ||
      !["running", "paused", "stopped", "complete"].includes(p.status) ||
      !store.users.has(p.owner) ||
      !strategy ||
      strategy.ownerId !== p.owner ||
      !strategy.versions.some((v) => v.version === p.version)
    ) {
      throw Error("Invalid mainnet checkpoint identity");
    }
    const w = validateLiveRequest(p);
    const journal = restoreLedger(serializeLedger(p.ledger));
    if (
      journal.scope !== id ||
      !Number.isSafeInteger(p.controlEpoch ?? 0) ||
      (p.controlEpoch ?? 0) < 0
    )
      throw Error("Invalid live execution journal");
    if (
      Object.keys(p.orders).length !== journal.orders.length ||
      w.stages.length !== Object.keys(p.stages).length
    )
      throw Error("Mainnet order index is incomplete");
    const indexed = new Set<string>();
    for (const stage of w.stages) {
      const idx = p.stages[stage.id];
      if (!idx || !Array.isArray(idx.entries) || !Array.isArray(idx.exits))
        throw Error("Invalid mainnet stage index");
      for (const [leg, ids] of [
        ["entry", idx.entries],
        ["exit", idx.exits],
      ] as const) {
        for (const key of ids) {
          const o = p.orders[key];
          if (
            indexed.has(key) ||
            !o ||
            o.action.stage !== stage.id ||
            o.action.leg !== leg
          )
            throw Error("Invalid mainnet stage attribution");
          indexed.add(key);
        }
      }
    }
    for (const l of journal.orders) {
      const o = p.orders[l.spec.id],
        a = o?.action,
        b = p.wallets.find((v) => v.network === a?.network);
      if (
        !a ||
        !indexed.has(l.spec.id) ||
        a.id !== l.spec.id ||
        a.owner !== p.owner ||
        a.programId !== id ||
        a.strategyId !== p.strategyId ||
        a.version !== p.version ||
        !b ||
        a.wallet !== b.wallet ||
        l.spec.termsHash !== o.digest ||
        l.spec.venue !== a.network ||
        (l.dispatched &&
          (!o.recoveryId || !Number.isSafeInteger(o.dispatchedAt)))
      )
        throw Error("Invalid mainnet execution binding");
    }
    p.ledger = journal;
    if (hold) {
      p.status = "paused";
      p.controlEpoch = (p.controlEpoch ?? 0) + 1;
      p.revision++;
      for (const l of journal.orders)
        if (!l.dispatched && !liveTerminal(l.status))
          p.ledger = transition(p.ledger, {
            kind: "revoke",
            id: l.spec.id,
          }).next;
      p.message =
        "Restored backup. Reconcile the wallet and exchange history before authorizing another order.";
    }
  }
  if (!hold) return;
  for (const r of store.liveAllowances.values())
    if (r.state === "review") r.state = "declined";
  for (const g of store.privySpotGrants.values()) {
    g.sealed = "";
    g.status = "disabled";
    g.revision++;
  }
  for (const a of store.liveAccess.values()) {
    a.paused = true;
    delete a.consent;
    if (a.agent) {
      a.agent.sealed = "";
      a.agent.state = "disabled";
    }
  }
}
type Guard = {
  d: { now: () => number };
  allow: (owner: string, a: Action) => boolean;
};
function recoveryKey(network: Action["network"], value: string) {
  return (
    network + "|" + (network === "solana-mainnet" ? value : value.toLowerCase())
  );
}
function normalizedNotional(a: Action) {
  if (
    a.notionalUsd6 &&
    /^[0-9]{1,60}$/.test(a.notionalUsd6) &&
    BigInt(a.notionalUsd6) > 0n
  )
    return BigInt(a.notionalUsd6);
  throw new HostError(
    409,
    "Live order notional must be established in USD before dispatch.",
  );
}

/** Used with PostgresPersistence's advisory single-engine lock, revision compare-and-swap and durable commit. */
export class MainnetStore implements LiveStore {
  private tail: Promise<void> = Promise.resolve();
  private uncertain = false;
  constructor(
    readonly data: Data,
    private healthy: () => boolean,
    private write: () => Promise<void>,
    private access: Guard,
  ) {}
  private usable() {
    if (this.uncertain || !this.healthy())
      throw new HostError(
        503,
        "Mainnet storage is unavailable. Reconcile its last checkpoint before reopening execution.",
      );
  }
  async read(owner: string, id: string) {
    await this.tail;
    this.usable();
    const p = this.data.livePrograms.get(id);
    return p?.owner === owner ? structuredClone(p) : null;
  }
  async cas(
    owner: string,
    id: string,
    prior: number | null,
    proposal: LiveProgram,
  ) {
    const next = structuredClone(proposal);
    const job = this.tail.then(async () => {
      this.usable();
      const before = this.data.livePrograms.get(id);
      if (
        next.owner !== owner ||
        next.id !== id ||
        next.revision !== (prior === null ? 0 : prior + 1) ||
        (before
          ? before.owner !== owner || before.revision !== prior
          : prior !== null)
      )
        return false;
      if (!before) {
        const lanes = new Set(next.wallets.map(walletKey));
        if (
          [...this.data.livePrograms.values()].some(
            (p) =>
              controlsFunds(p) &&
              p.wallets.some((b) => lanes.has(walletKey(b))),
          )
        )
          return false;
        if (
          [...this.data.livePrograms.values()].filter((p) => p.owner === owner)
            .length >= 150
        )
          throw new HostError(429, "Live run retention limit reached.");
      } else {
        for (const o of before.ledger.orders)
          if (o.dispatched) {
            const proposed = next.ledger.orders.find(
              (n) => n.spec.id === o.spec.id,
            );
            if (
              !proposed?.dispatched ||
              next.orders[o.spec.id]?.recoveryId !==
                before.orders[o.spec.id].recoveryId
            )
              throw new HostError(
                409,
                "A consumed dispatch cannot be removed or rebound.",
              );
          }
      }
      const launched = next.ledger.orders.filter(
        (o) =>
          o.dispatched &&
          !before?.ledger.orders.find((x) => x.spec.id === o.spec.id)
            ?.dispatched,
      );
      if (launched.length) {
        const checkpoints = [...this.data.livePrograms.values()].filter(
          (p) => p.id !== id,
        );
        checkpoints.push(next);
        for (const o of launched) {
          const row = next.orders[o.spec.id],
            a = row?.action;
          if (
            !a ||
            !row.recoveryId ||
            !Number.isSafeInteger(row.dispatchedAt) ||
            Math.abs(this.access.d.now() - row.dispatchedAt!) > 20000 ||
            !this.access.allow(owner, a)
          )
            throw new HostError(
              403,
              "Live funds or the wallet permission are paused.",
            );
          const rid = recoveryKey(a.network, row.recoveryId);
          const conflict = checkpoints.some((p) =>
            Object.values(p.orders).some(
              (x) =>
                (p.id !== id || x.action.id !== o.spec.id) &&
                x.recoveryId &&
                recoveryKey(x.action.network, x.recoveryId) === rid,
            ),
          );
          const reserved =
            a.network === "robinhood-mainnet" &&
            [...this.data.liveAllowances.values()].some(
              (r) =>
                !["review", "declined"].includes(r.state) &&
                rid ===
                  recoveryKey(
                    a.network,
                    "rh:4663:" + r.terms.owner + ":" + r.terms.nonce,
                  ),
            );
          if (conflict || reserved)
            throw new HostError(
              409,
              "This venue transaction or wallet nonce was already claimed.",
            );
        }
        if (
          launched.some((l) => next.orders[l.spec.id].action.leg === "entry")
        ) {
          const floor = this.access.d.now() - 86400000,
            cap = this.data.liveAccess.get(owner)?.consent?.limits.dailyUsd;
          if (!cap || !Number.isSafeInteger(Math.floor(cap * 1e6)))
            throw new HostError(403, "Review your live spend limit.");
          let used = 0n;
          for (const p of checkpoints)
            if (p.owner === owner)
              for (const o of Object.values(p.orders)) {
                if (
                  o.action.leg === "entry" &&
                  o.dispatchedAt !== undefined &&
                  o.dispatchedAt >= floor
                )
                  used += normalizedNotional(o.action);
              }
          if (used > BigInt(Math.floor(cap * 1e6)))
            throw new HostError(
              409,
              "This order exceeds your account’s rolling 24-hour live notional limit.",
            );
        }
      }
      this.data.livePrograms.set(id, next);
      try {
        await this.write();
      } catch (e) {
        this.uncertain = true;
        throw e;
      }
      // An owner can pause while PostgreSQL is acknowledging the claim. Keep that claim
      // consumed and refuse to release a wallet request or instruct a transport to send.
      if (
        launched.some(
          (o) => !this.access.allow(owner, next.orders[o.spec.id].action),
        )
      )
        return false;
      return true;
    });
    this.tail = job.then(
      () => {},
      () => {},
    );
    return job;
  }
}
