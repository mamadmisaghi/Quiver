import { describe, expect, it } from "vitest";
import { MemStore, type StrategyRow, type User } from "../../src/store";
import type { Hosted } from "../../src/workflows/host";
import type { LiveProgram } from "../../src/execution/live-program";
import {
  workspaceRevenue,
  workspaceRewards,
} from "../../src/workflows/participation";

describe("production participation accounting", () => {
  const at = Date.UTC(2026, 10, 2);
  function fixture() {
    const store = new MemStore();
    for (const id of ["alice", "bob", "carol"])
      store.users.set(id, {
        id,
        label: "privy:did:privy:" + id,
        createdAt: at,
      } as User);
    return store;
  }
  function strategy(
    id: string,
    ownerId: string,
    data: Partial<StrategyRow> = {},
  ): StrategyRow {
    return {
      id,
      ownerId,
      createdAt: at,
      archived: false,
      versions: [{ strategy: { name: id } }],
      ...data,
    } as StrategyRow;
  }
  it("counts only achieved milestones, owned records, and server-observed sessions in this season", () => {
    const store = fixture();
    store.strategies.set(
      "a",
      strategy("a", "alice", { public: true, publishedAt: at + 10 }),
    );
    store.strategies.set(
      "b",
      strategy("b", "bob", { forkedFrom: "a", createdAt: at + 20 }),
    );
    store.workflowSessions.set("imported", {
      owner: "alice",
      session: { provenance: "imported", createdAt: at },
    } as Hosted);
    const alice = workspaceRewards(store, "alice", at + 30);
    expect(alice.points).toBe(550);
    expect(alice.history.map((h) => Date.parse(h.at))).toEqual([
      at,
      at + 10,
      at + 20,
    ]);
    expect([alice.rank, alice.totalParticipants]).toEqual([1, 2]);
    expect(workspaceRewards(store, "carol", at + 30).rank).toBe(0);
    expect(workspaceRewards(store, "alice", Date.UTC(2027, 0, 1)).points).toBe(
      0,
    );
  });
  it("counts venue-confirmed fills on another owner's copy and leaves cash earnings at zero", () => {
    const store = fixture();
    store.strategies.set("a", strategy("a", "alice", { public: true }));
    store.strategies.set("b", strategy("b", "bob", { forkedFrom: "a" }));
    store.livePrograms.set("r", {
      strategyId: "b",
      owner: "bob",
      ledger: {
        orders: [{ executions: [{ fillId: "confirmed" }] }, { executions: [] }],
      },
    } as LiveProgram);
    const revenue = workspaceRevenue(store, "alice");
    expect(revenue.rows[0]).toMatchObject({
      forks: 1,
      settledFills: 1,
      earnedUsd: "0.00",
    });
    expect(revenue).toMatchObject({
      mock: false,
      accounting: "live_ledger",
      claimEnabled: false,
      claimableUsd: "0.00",
    });
    expect(workspaceRevenue(store, "carol").rows).toEqual([]);
  });
});
