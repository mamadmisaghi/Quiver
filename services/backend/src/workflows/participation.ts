import type { MemStore } from "../store";

const milestones = [
  { id: "draft", title: "Save a strategy", points: 100 },
  { id: "paper", title: "Start an observed paper session", points: 150 },
  { id: "publish", title: "Publish a strategy", points: 200 },
  {
    id: "forked",
    title: "Have another trader copy your strategy",
    points: 250,
  },
] as const;

export function workspaceRewards(store: MemStore, user: string, now: number) {
  const year = new Date(now).getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1) - 1;
  const records = new Map<string, Map<string, number>>();
  for (const person of store.users.values()) {
    if (person.label.startsWith("privy:did:privy:") || person.id === user)
      records.set(person.id, new Map());
  }
  const remember = (owner: string, key: string, at?: number) => {
    const row = records.get(owner);
    if (row && at !== undefined && at >= start && at <= now)
      row.set(key, Math.min(at, row.get(key) ?? at));
  };
  for (const s of store.strategies.values()) {
    remember(s.ownerId, "draft", s.createdAt);
    remember(s.ownerId, "publish", s.publishedAt);
    const source = store.strategies.get(
      s.copyOf?.publicStrategyId ?? s.forkedFrom ?? "",
    );
    if (source && source.ownerId !== s.ownerId && records.has(s.ownerId)) {
      remember(source.ownerId, "forked", s.copyOf?.copiedAt ?? s.createdAt);
    }
  }
  for (const row of store.workflowSessions.values()) {
    if (row.session.provenance === "server")
      remember(row.owner, "paper", row.session.createdAt);
  }
  const own = records.get(user) ?? new Map<string, number>();
  const score = (row: Map<string, number>) =>
    milestones.reduce((sum, q) => sum + (row.has(q.id) ? q.points : 0), 0);
  const points = score(own);
  const participants = [...records.values()].filter((row) => row.size > 0);
  return {
    mock: false,
    example: false,
    notice: "Workspace points record participation and have no cash value.",
    points,
    season: {
      id: String(year),
      name: year + " workspace milestones",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
    },
    rank: own.size
      ? 1 + participants.filter((row) => score(row) > points).length
      : 0,
    totalParticipants: participants.length,
    quests: milestones.map((q) => ({
      ...q,
      done: own.has(q.id),
      progress: own.has(q.id) ? 1 : 0,
    })),
    history: milestones
      .flatMap((q) =>
        own.has(q.id)
          ? [
              {
                at: new Date(own.get(q.id)!).toISOString(),
                points: q.points,
                reason: q.title,
              },
            ]
          : [],
      )
      .sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export function workspaceRevenue(store: MemStore, owner: string) {
  const strategies = [...store.strategies.values()];
  const copies = new Map(
    strategies
      .filter((s) => s.ownerId !== owner && (s.copyOf || s.forkedFrom))
      .map((s) => [s.id, s.copyOf?.publicStrategyId ?? s.forkedFrom!]),
  );
  const fills = new Map<string, number>();
  for (const p of store.livePrograms.values()) {
    const source = copies.get(p.strategyId);
    if (source && p.owner !== owner)
      fills.set(
        source,
        (fills.get(source) ?? 0) +
          p.ledger.orders.reduce((sum, o) => sum + o.executions.length, 0),
      );
  }
  const forks = new Map<string, number>();
  for (const source of copies.values())
    forks.set(source, (forks.get(source) ?? 0) + 1);
  const rows = strategies
    .filter((s) => s.ownerId === owner && (s.public || s.publishedAt))
    .map((s) => ({
      strategyId: s.id,
      name: s.versions.at(-1)!.strategy.name,
      forks: forks.get(s.id) ?? 0,
      settledFills: fills.get(s.id) ?? 0,
      followersVolumeUsd: "0.00",
      earnedUsd: "0.00",
    }));
  return {
    mock: false,
    accounting: "live_ledger" as const,
    earnedUsd: "0.00",
    claimableUsd: "0.00",
    forks: rows.reduce((sum, row) => sum + row.forks, 0),
    creatorSharePct: null,
    claimEnabled: false as const,
    rows,
    notice:
      "Quiver charges no platform fee in this release. Your strategy copies and their confirmed fills are counted here. Venue fees do not create a creator payout.",
  };
}
