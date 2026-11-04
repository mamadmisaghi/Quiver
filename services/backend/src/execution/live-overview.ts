import type { MemStore } from "../store";
import type { LiveCoordinator, Network } from "./live-program";
type Item = {
  run: string;
  name: string;
  stage: string;
  side: string;
  symbol: string;
  network: Network;
  status: string;
  quantity: string;
  proof: string | null;
  when: number;
  sequence: number;
};
export async function liveOverview(
  store: MemStore,
  engine: LiveCoordinator,
  owner: string,
  now = Date.now(),
) {
  const history: Item[] = [],
    pending: Item[] = [],
    positions: {
      run: string;
      name: string;
      symbol: string;
      network: Network;
      qty: string;
      asset: string;
      decimals: number | null;
      average: number;
    }[] = [];
  const owned = [...store.livePrograms.values()].filter(
    (r) => r.owner === owner,
  );
  for (const r of owned) {
    const v = await engine.view(owner, r.id);
    for (const o of v.orders) {
      const stored = r.orders[o.id],
        row = {
          run: r.id,
          name: r.strategy.name,
          stage: o.stage,
          side: o.side,
          symbol: o.market.symbol,
          network: o.network,
          status: o.status,
          quantity: o.filledUnits,
          proof: o.orderRef ?? o.recoveryId,
          when: stored.dispatchedAt ?? r.createdAt,
          sequence: o.sequence,
        };
      if (
        o.status === "planned" &&
        o.expiresAt > now &&
        (v.status === "running" || o.leg === "exit")
      )
        pending.push(row);
      if (stored.dispatchedAt || o.orderRef) history.push(row);
    }
    for (const stage of v.stages)
      if (stage.holding) {
        const entry = v.orders.find(
          (o) =>
            o.stage === stage.id && o.leg === "entry" && o.filledUnits !== "0",
        );
        if (!entry) continue;
        const h = r.orders[entry.id]?.holding;
        positions.push({
          run: r.id,
          name: r.strategy.name,
          symbol: entry.market.symbol,
          network: entry.network,
          asset: stage.holding.asset,
          qty: stage.holding.quantity,
          decimals:
            h?.quantityDecimals ??
            (entry.network === "hyperliquid-mainnet" ||
            entry.network === "robinhood-mainnet"
              ? 18
              : null),
          average: stage.holding.averageEntryUsd,
        });
      }
  }
  return {
    pending: pending.sort((a, b) => b.when - a.when),
    history: history.sort((a, b) => b.when - a.when).slice(0, 150),
    positions,
  };
}
