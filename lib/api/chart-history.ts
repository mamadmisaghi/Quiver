import { MarketHistoryRes } from "@/lib/contracts/market";
import type { MarketRange, MarketTf } from "./types";

const history = new Map<
  string,
  { expires: number; promise: Promise<MarketHistoryRes> }
>();
export function publicChartHistory(
  id: string,
  tf: MarketTf,
  range: MarketRange,
) {
  const query = new URLSearchParams({ id, tf, range }).toString(),
    current = history.get(query);
  if (current && current.expires > Date.now()) return current.promise;
  const promise = fetch("/api/preview/market-history?" + query).then(
    async (res) => {
      if (!res.ok) throw Error("Market history is temporarily unavailable.");
      return MarketHistoryRes.parse(await res.json());
    },
  );
  history.set(query, { expires: Date.now() + 60000, promise });
  if (history.size > 96) history.delete(history.keys().next().value!);
  void promise.catch(() => {
    if (history.get(query)?.promise === promise) history.delete(query);
  });
  return promise;
}
