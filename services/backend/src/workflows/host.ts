import { z } from "zod";
import { newId } from "../lib/ids";
import { quoteAsset } from "./quotes";
import { createPaper, paperProblems, stepPaper, type EntryIntent, type PaperStepEvent } from "./paper";
import { PaperSessionSchema, activeSessionMs, appendActivity, type PaperSession } from "./session";
import { preparePaperEdit, type EditOps } from "./changes";
import { tickActivity, stageLabel, type MarketObservation, type ActivityNote } from "./observations";
import type { Strategy } from "../../contracts/src/strategy";
import type { Workflow } from "../../contracts/src/workflow";

export const Approval = z.object({
  id: z.string(),
  key: z.string(),
  stageId: z.string(),
  amount: z.number().nonnegative(),
  price: z.number().positive(),
  expiresAt: z.number(),
  decision: z.enum(["pending", "approved", "rejected"]),
});
export type Approval = z.infer<typeof Approval>;
export type Hosted = {
  owner: string;
  requestKey: string;
  session: PaperSession;
  mode: "auto" | "confirm_each";
  approvalTtlSec?: number;
  approvals: Approval[];
  observations: MarketObservation[];
  trace: PaperStepEvent[];
  serial: number;
};
export class HostError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}
type Options = {
  records: Map<string, Hosted>;
  now: () => number;
  commit: () => Promise<void>;
  healthy: () => boolean;
  quote?: (a: Workflow["assets"][number]) => Promise<MarketObservation>;
  tiingo?: string;
  intervalMs: number;
  maxActive: number;
};

export class WorkflowHost {
  private timer?: ReturnType<typeof setInterval>;
  private wave: Promise<void> | null = null;
  private stopped = false;
  private pending = new Set<string>();
  lastCompletedAt: number | null = null;
  failedCycles = 0;
  constructor(private d: Options) {}
  list(owner: string) {
    return [...this.d.records.values()]
      .filter((r) => r.owner === owner)
      .sort((a, b) => b.session.createdAt - a.session.createdAt);
  }
  owned(owner: string, id: string) {
    const r = this.d.records.get(id);
    if (!r || r.owner !== owner) throw new HostError(404, "Paper session not found.");
    return r;
  }
  view(row: Hosted) {
    const s = row.session;
    // Only the server needs the raw observation window, entry anchors and allocations.
    return {
      session: { ...s, state: s.state && { ...s.state, history: {}, anchors: {} } },
      mode: row.mode,
      approvals: row.approvals,
      observations: row.observations,
      trace: row.trace,
      serial: row.serial,
    };
  }
  private checkStorage() {
    if (this.stopped || !this.d.healthy()) throw new HostError(503, "The session store is unavailable.");
  }
  private room(owner: string, starting: boolean) {
    this.checkStorage();
    const rows = this.list(owner);
    if (starting && rows.filter((r) => r.session.status === "running").length >= this.d.maxActive)
      throw new HostError(429, "Pause a running session before starting another.");
    return rows;
  }
  start(
    owner: string,
    key: string,
    strategyId: string,
    version: number,
    strategy: Strategy,
    mode: Hosted["mode"],
    approvalTtlSec = 120,
  ) {
    const prior = this.list(owner).find((r) => r.requestKey === key);
    if (prior) {
      if (
        prior.session.strategyId !== strategyId ||
        prior.session.strategyVersion !== version ||
        prior.mode !== mode ||
        (mode === "confirm_each" && (prior.approvalTtlSec ?? 120) !== approvalTtlSec)
      )
        throw new HostError(409, "This launch key belongs to a different session.");
      return prior;
    }
    if (this.room(owner, true).length >= 100)
      throw new HostError(429, "The account has reached its session retention limit.");
    const w = strategy.workflow;
    if (!w) throw new HostError(422, "Choose a workflow strategy.");
    const issue = paperProblems(w, true)[0];
    if (issue) throw new HostError(422, issue);
    const at = this.d.now(),
      id = newId("srvpaper", at);
    const session: PaperSession = {
      version: 1,
      id,
      strategyId,
      strategyVersion: version,
      name: strategy.name,
      strategy: structuredClone(strategy),
      provenance: "server",
      mode: "quotes",
      status: "running",
      activeMs: 0,
      controlVersion: 0,
      createdAt: at,
      updatedAt: at,
      state: createPaper(w, at),
    };
    session.activity = appendActivity(session, [
      { at, kind: "session", label: "Session started", detail: "Server observation is running." },
    ]);
    const row: Hosted = {
      owner,
      requestKey: key,
      session,
      mode,
      approvalTtlSec,
      approvals: [],
      observations: [],
      trace: [],
      serial: 0,
    };
    this.d.records.set(id, row);
    return row;
  }
  importArchive(owner: string, raw: PaperSession) {
    const key = "archive:" + raw.id;
    const existing = this.list(owner).find((r) => r.requestKey === key);
    if (existing) return existing;
    if (this.room(owner, false).length >= 100)
      throw new HostError(429, "The account has reached its session retention limit.");
    if (!raw.id.startsWith("paper_") || !raw.strategy.workflow)
      throw new HostError(422, "Select a browser workflow session.");
    const session = PaperSessionSchema.parse({
      ...raw,
      id: newId("srvpaper", this.d.now()),
      provenance: "imported",
      status: "completed",
      controlVersion: 0,
    });
    const row: Hosted = {
      owner,
      requestKey: key,
      session,
      mode: "auto",
      approvals: [],
      observations: [],
      trace: [],
      serial: 0,
    };
    this.d.records.set(session.id, row);
    return row;
  }
  private changing(owner: string, id: string, expected: number) {
    this.checkStorage();
    const row = this.owned(owner, id);
    if (row.session.provenance !== "server" || row.session.status === "completed")
      throw new HostError(409, "This session is archived.");
    if ((row.session.controlVersion ?? 0) !== expected)
      throw new HostError(409, "Session controls changed. Refresh before trying again.");
    return row;
  }
  private update(
    row: Hosted,
    next: Partial<PaperSession>,
    label: string,
    detail: string,
    kind: ActivityNote["kind"] = "session",
    approvals: Approval[] = [],
  ) {
    const s = row.session,
      at = this.d.now();
    const updated: Hosted = {
      ...row,
      serial: row.serial + 1,
      trace: [],
      approvals,
      session: {
        ...s,
        ...next,
        activeMs: activeSessionMs(s, at, true),
        updatedAt: at,
        controlVersion: (s.controlVersion ?? 0) + 1,
        activity: appendActivity(s, [{ at, kind, label, detail }]),
      },
    };
    this.d.records.set(s.id, updated);
    return updated;
  }
  control(owner: string, id: string, expected: number, command: "pause" | "resume" | "stop") {
    const row = this.changing(owner, id, expected),
      status = command === "pause" ? "paused" : command === "resume" ? "running" : "completed";
    if (row.session.status === status) return row;
    if (status === "running") this.room(owner, true);
    return this.update(
      row,
      { status },
      command === "stop" ? "Session stopped" : command === "pause" ? "Session paused" : "Session resumed",
      command === "stop"
        ? "Final paper checkpoint saved."
        : "Server observation " + (status === "running" ? "resumed." : "paused."),
    );
  }
  edit(owner: string, id: string, expected: number, ops: EditOps) {
    const row = this.changing(owner, id, expected);
    try {
      const change = preparePaperEdit(row.session, ops);
      return this.update(
        row,
        {
          strategy: change.strategy,
          pausedRules: change.pausedRules,
          editRevision: (row.session.editRevision ?? 0) + 1,
          rulesChangedAt: this.d.now(),
        },
        "Rules updated",
        change.summaries.join(" · "),
        "edit",
      );
    } catch (e) {
      throw new HostError(422, e instanceof Error ? e.message : "Invalid edit.");
    }
  }
  decide(owner: string, id: string, expected: number, approvalId: string, decision: "approved" | "rejected") {
    const row = this.changing(owner, id, expected),
      a = row.approvals.find((a) => a.id === approvalId);
    if (row.session.status !== "running" || !a || a.expiresAt <= this.d.now() || a.decision !== "pending")
      throw new HostError(409, "This approval is no longer pending.");
    return this.update(
      row,
      {},
      decision === "approved" ? "Entry approved" : "Entry rejected",
      stageLabel(row.session.strategy.workflow!, a.stageId),
      "session",
      row.approvals.map((x) => (x.id === a.id ? { ...x, decision } : x)),
    );
  }
  startDriver() {
    if (this.timer) return;
    const at = this.d.now();
    for (const [id, row] of this.d.records)
      if (row.session.status === "running" && row.session.provenance === "server") {
        this.d.records.set(id, {
          ...row,
          serial: row.serial + 1,
          approvals: [],
          trace: [],
          session: {
            ...row.session,
            updatedAt: at,
            activity: appendActivity(row.session, [
              {
                at,
                kind: "session",
                label: "Server resumed",
                detail: "Recovered the last checkpoint. Waiting for a fresh observation.",
              },
            ]),
          },
        });
      }
    this.timer = setInterval(() => void this.cycle(), this.d.intervalMs);
    this.timer.unref?.();
    void this.cycle();
  }
  async stopDriver() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.wave;
  }
  async cycle() {
    if (this.stopped || !this.d.healthy() || this.wave) return this.wave;
    const active = [...this.d.records.values()].filter(
      (r) => r.session.status === "running" && r.session.provenance === "server",
    );
    const cache = new Map<string, Promise<MarketObservation>>();
    this.wave = (async () => {
      for (let i = 0; i < active.length && !this.stopped; i += 6)
        await Promise.all(active.slice(i, i + 6).map((r) => this.tick(r.session.id, cache)));
      if (active.length && !this.stopped) await this.d.commit();
      this.lastCompletedAt = this.d.now();
    })()
      .catch(() => {
        this.failedCycles++;
      })
      .finally(() => {
        this.wave = null;
      });
    return this.wave;
  }
  async tick(id: string, cache = new Map<string, Promise<MarketObservation>>()) {
    const row = this.d.records.get(id);
    if (
      !row ||
      this.stopped ||
      !this.d.healthy() ||
      row.session.status !== "running" ||
      row.session.provenance !== "server" ||
      this.pending.has(id)
    )
      return;
    this.pending.add(id);
    try {
      const s = row.session,
        w = s.strategy.workflow!,
        items: MarketObservation[] = [];
      for (let i = 0; i < w.assets.length; i += 4)
        items.push(
          ...(await Promise.all(
            w.assets.slice(i, i + 4).map(async (asset) => {
              // The complete selected definition matters, not an untrusted id supplied in a draft.
              const key = JSON.stringify({ ...asset, id: "" });
              if (!cache.has(key))
                cache.set(
                  key,
                  (this.d.quote
                    ? this.d.quote(asset)
                    : quoteAsset(asset, undefined, this.d.tiingo).then((result) => ({
                        assetId: asset.id,
                        ...result,
                      }))
                  ).catch(() => ({ assetId: asset.id, quote: null, message: "Market data unavailable." })),
                );
              const item = await cache.get(key)!;
              return {
                ...item,
                assetId: asset.id,
                quote: item.quote && !item.quote.synthetic ? { ...item.quote, assetId: asset.id } : null,
              };
            }),
          )),
        );
      if (this.stopped || !this.d.healthy() || this.d.records.get(id) !== row) return;
      const at = this.d.now(),
        before = s.state!;
      if (at <= before.lastAt) return;
      const approvals: Approval[] = [],
        trace: PaperStepEvent[] = [];
      const gate = (intent: EntryIntent) => {
        const previous = row.approvals.find((a) => a.key === intent.key);
        if (previous?.decision === "rejected") {
          approvals.push(previous);
          return false;
        }
        if (
          previous &&
          previous.expiresAt > at &&
          intent.amount <= previous.amount * 1.00000001 &&
          Math.abs(intent.price / previous.price - 1) <= 0.005
        ) {
          if (previous.decision === "approved") return true;
          approvals.push(previous);
          return false;
        }
        approvals.push({
          ...intent,
          id: newId("apv", at),
          expiresAt: at + (row.approvalTtlSec ?? 120) * 1000,
          decision: "pending",
        });
        return false;
      };
      const unavailable = new Set(items.filter((i) => !i.quote).map((i) => i.assetId));
      const state = stepPaper(
        w,
        before,
        items.flatMap((i) => (i.quote ? [i.quote] : [])),
        at,
        s.strategy.risk,
        trace,
        s.pausedRules,
        row.mode === "confirm_each" ? gate : undefined,
        unavailable,
      );
      const notes = tickActivity(w, before, state, items, trace);
      for (const a of approvals)
        if (!row.approvals.some((p) => p.id === a.id))
          notes.push({ at, kind: "wait", label: "Approval requested", detail: stageLabel(w, a.stageId) });
      this.d.records.set(id, {
        ...row,
        serial: row.serial + 1,
        observations: items,
        trace,
        approvals,
        session: {
          ...s,
          activeMs: activeSessionMs(s, at, true),
          updatedAt: at,
          state,
          activity: appendActivity(s, notes),
        },
      });
    } finally {
      this.pending.delete(id);
    }
  }
}
