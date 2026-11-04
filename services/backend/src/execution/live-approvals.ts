import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import type { MemStore, User } from "../store";
import { HostError } from "../workflows/host";
import type { LiveAuthority } from "./live-authority";
import type { Action, LiveProgram } from "./live-program";
import type {
  RhPrepared,
  RhResult,
  RobinhoodMainnet,
} from "./robinhood-mainnet";

export type AllowanceRequest = {
  id: string;
  owner: string;
  program: string;
  stage: string;
  actionId: string;
  terms: RhPrepared;
  manualExit?: boolean;
  declinedByUser?: boolean;
  epoch?: number;
  state: "review" | "claimed" | "confirmed" | "failed" | "declined";
  txHash?: Hex;
  cursor?: string;
  lastChecked?: number;
  result?: RhResult;
};
const txid = (a: RhPrepared) =>
  "rh:4663:" + a.owner.toLowerCase() + ":" + a.nonce;
const canPrompt = (a: AllowanceRequest, p: LiveProgram | undefined) =>
  !!p &&
  p.owner === a.owner &&
  (p.status === "running" || a.manualExit === true);

export class AllowanceQueue {
  private locks = new Set<string>();
  constructor(
    private store: MemStore,
    private venue: RobinhoodMainnet,
    private access: LiveAuthority,
    private commit: () => Promise<void>,
    private now: () => number,
  ) {}
  fees(program: string, since = 0) {
    let held = 0n,
      paid = 0n;
    for (const a of this.store.liveAllowances.values())
      if (a.program === program) {
        if (a.state === "claimed") held += BigInt(a.terms.maxFeeWei);
        else if (
          a.result?.feeWei &&
          a.result.blockTime !== undefined &&
          a.result.blockTime >= since
        )
          paid += BigInt(a.result.feeWei);
      }
    return { held, paid };
  }
  async queue(action: Action, terms: RhPrepared) {
    if (
      terms.kind === "swap" ||
      !this.access.allow(action.owner, action) ||
      action.network !== "robinhood-mainnet" ||
      action.wallet.toLowerCase() !== terms.owner.toLowerCase() ||
      action.spendUnits !== terms.inputUnits
    )
      throw new HostError(
        403,
        "This stock allowance exceeds the workflow's instructions.",
      );
    const p = this.store.livePrograms.get(action.programId),
      manualExit =
        action.reduceOnly &&
        action.leg === "exit" &&
        action.exitReason === "Manual close";
    if (
      !p ||
      p.owner !== action.owner ||
      (p.status !== "running" && !manualExit)
    )
      throw new HostError(409, "This workflow is paused.");
    const records = [...this.store.liveAllowances.values()].filter(
      (v) => v.owner === action.owner,
    );
    if (
      records.some(
        (a) =>
          a.declinedByUser &&
          a.actionId === action.id &&
          a.terms.kind === terms.kind &&
          a.epoch === (p.controlEpoch ?? 0),
      )
    )
      return;
    if (
      records.some(
        (a) =>
          a.state === "claimed" ||
          (a.state === "review" &&
            a.terms.expiresAt > this.now() &&
            canPrompt(a, this.store.livePrograms.get(a.program))),
      )
    )
      return;
    if (records.length >= 300)
      throw new HostError(
        429,
        "This account reached its allowance history limit.",
      );
    for (const a of records) if (a.state === "review") a.state = "declined";
    const id = "allow_" + randomBytes(12).toString("hex");
    this.store.liveAllowances.set(id, {
      id,
      owner: action.owner,
      program: action.programId,
      stage: action.stage,
      actionId: action.id,
      manualExit,
      terms,
      state: "review",
    });
    await this.commit();
  }
  list(uid: string) {
    return [...this.store.liveAllowances.values()]
      .filter((a) => a.owner === uid)
      .slice(-50)
      .reverse()
      .map((a) => ({
        id: a.id,
        program: a.program,
        stage: a.stage,
        kind: a.terms.kind,
        state: a.state,
        asset: a.terms.inputToken,
        amount: a.terms.kind === "approve_zero" ? "0" : a.terms.inputUnits,
        expiresAt: a.terms.expiresAt,
        wallet: a.terms.owner,
        fee: a.terms.maxFeeWei,
        digest: a.terms.termsHash,
        txHash: a.txHash ?? a.result?.txHash ?? null,
      }));
  }
  private owned(u: User, id: string) {
    const a = this.store.liveAllowances.get(id);
    if (!a || a.owner !== u.id)
      throw new HostError(404, "Stock allowance not found.");
    return a;
  }
  private consent(a: AllowanceRequest) {
    if (!a.manualExit) {
      this.access.require(a.owner, "robinhood-mainnet", a.terms.owner);
      return;
    }
    this.access.writable();
    if (
      !this.access.linked(a.owner, a.terms.owner, "robinhood-mainnet") ||
      !this.access.eligible(a.owner, "robinhood-mainnet", true)
    )
      throw new HostError(
        403,
        "Verify the wallet and venue permission before closing.",
      );
  }
  private verifyClaim(a: AllowanceRequest) {
    const t = a.terms,
      p = this.store.livePrograms.get(a.program);
    this.consent(a);
    if (!p || !canPrompt(a, p) || t.expiresAt <= this.now())
      throw new HostError(409, "The allowance or workflow changed.");
    const gas = p.ledger.accounts.find(
        (v) => v.venue === "robinhood-mainnet" && v.asset === "ETH",
      ),
      fees = this.fees(p.id);
    if (!gas || BigInt(gas.free) - fees.held - fees.paid < BigInt(t.maxFeeWei))
      throw new HostError(
        409,
        "The remaining ETH fee budget is too small for this allowance.",
      );
    const ref = txid(t);
    if (
      [...this.store.livePrograms.values()].some((v) =>
        Object.values(v.orders).some(
          (o) => o.recoveryId?.toLowerCase() === ref,
        ),
      ) ||
      [...this.store.liveAllowances.values()].some(
        (v) => v !== a && v.state === "claimed" && txid(v.terms) === ref,
      )
    )
      throw new HostError(
        409,
        "Another transaction already reserved this wallet nonce.",
      );
    return p.controlEpoch ?? 0;
  }
  async claim(u: User, id: string, digest: string) {
    const a = this.owned(u, id),
      t = a.terms;
    if (a.state !== "review" || this.locks.has(id) || t.termsHash !== digest)
      throw new HostError(
        409,
        "This allowance has already been released or changed.",
      );
    const epoch = this.verifyClaim(a);
    this.locks.add(id);
    try {
      await this.venue.validate(t, true);
      if (a.state !== "review" || this.verifyClaim(a) !== epoch)
        throw new HostError(409, "The workflow changed during verification.");
      a.state = "claimed";
      await this.commit();
      const p = this.store.livePrograms.get(a.program);
      if (
        !canPrompt(a, p) ||
        (p?.controlEpoch ?? 0) !== epoch ||
        t.expiresAt <= this.now()
      )
        throw new HostError(409, "The workflow stopped before wallet release.");
      this.consent(a);
      return {
        tx: t.tx,
        wallet: t.owner,
        expiresAt: t.expiresAt,
        maxNetworkFeeWei: t.maxFeeWei,
      };
    } finally {
      this.locks.delete(id);
    }
  }
  async refresh(u: User, id: string, hash?: Hex) {
    const a = this.owned(u, id);
    if (a.state !== "claimed" || this.locks.has(id)) return this.list(u.id);
    if (hash && !/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new HostError(422, "Invalid transaction hash.");
    this.locks.add(id);
    a.lastChecked = this.now();
    try {
      const result = await this.venue.reconcile(
        a.terms,
        hash ?? a.txHash,
        a.cursor,
      );
      if (result.status !== "unverified") {
        a.cursor = result.cursor;
        if (result.txHash && result.status !== "pending")
          a.txHash = result.txHash;
      }
      a.result = result;
      if (result.status === "approval_confirmed") a.state = "confirmed";
      if (result.status === "failed" || result.status === "replaced")
        a.state = "failed";
      await this.commit();
      return this.list(u.id);
    } finally {
      this.locks.delete(id);
    }
  }
  async poll() {
    const rows = [...this.store.liveAllowances.values()]
      .filter(
        (a) =>
          a.state === "claimed" && this.now() - (a.lastChecked ?? 0) >= 6000,
      )
      .sort((a, b) => (a.lastChecked ?? 0) - (b.lastChecked ?? 0))
      .slice(0, 4);
    await Promise.all(
      rows.map(async (a) => {
        const u = this.store.users.get(a.owner);
        if (u) await this.refresh(u, a.id).catch(() => {});
      }),
    );
  }
  decline(u: User, id: string) {
    const a = this.owned(u, id);
    if (a.state !== "review")
      throw new HostError(
        409,
        "The transaction was already released to the wallet.",
      );
    a.state = "declined";
    a.declinedByUser = true;
    a.epoch = this.store.livePrograms.get(a.program)?.controlEpoch ?? 0;
    return this.list(u.id);
  }
}
