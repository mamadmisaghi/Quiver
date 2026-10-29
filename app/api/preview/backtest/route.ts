import { BacktestReq, BacktestRes } from "@/lib/contracts";
import { runBacktest, BacktestError, RES_MS } from "@/services/backend/src/backtest/backtest";
import { validateStrategy, hasErrors } from "@/services/backend/src/engine/validate";
import { MockMarket } from "@/services/backend/src/venues/market";
import { mockAdapters } from "@/services/backend/src/venues/adapters";
import { MOCK_INSTRUMENTS, Registry } from "@/services/backend/src/venues/registry";

/** Actual evaluation of this draft, on explicitly SYNTHETIC prices. No credentials or orders. */
export async function POST(request: Request) {
  const fail = (status: number, message: string) => Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
  const reader = request.body?.getReader(); if (!reader) return fail(400, "Send a strategy to test.");
  let size = 0, text = ""; const decoder = new TextDecoder();
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32_000) { await reader.cancel(); return fail(413, "That strategy is too large for the preview."); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
  } catch { return fail(400, "Could not read that strategy."); }
  let raw: unknown; try { raw = JSON.parse(text); } catch { return fail(400, "Send a valid strategy request."); }
  const parsed = BacktestReq.safeParse(raw);
  if (!parsed.success || !parsed.data.strategy) return fail(422, "Send a valid strategy and starting balance.");
  const input = parsed.data, strategy = input.strategy!;
  const from = Date.parse(input.from), to = Date.parse(input.to), bars = (to - from) / RES_MS[input.resolution];
  if (to > Date.now() || to <= from || to - from > 31 * 86_400_000 || bars > 800 || strategy.signals.length > 12 || strategy.actions.length > 8 || strategy.triggers.length > 8) return fail(422, "Preview tests support up to 31 days, 800 bars, 12 signals and 8 rules/actions. Use a shorter range or simpler strategy.");
  const registry = new Registry(MOCK_INSTRUMENTS);
  const { issues } = validateStrategy(strategy, { registry, stockTokensAllowed: true });
  if (hasErrors(issues)) return fail(422, "Fix the strategy's validation errors before testing.");
  const mkt = new MockMarket(registry);
  try {
    const output = await runBacktest({ strategy, from, to, resolution: input.resolution, startingEquity: Number(input.startingEquityUsd), feeModel: input.feeModel }, { registry, mkt, adapters: mockAdapters(mkt, registry), stockTokensAllowed: true }, { canceled: () => request.signal.aborted, yield: () => Promise.resolve() });
    if (!output) return fail(408, "The test was canceled.");
    const result = BacktestRes.parse({ id: "bkt_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20), status: "done", progress: 1, dataSource: "fallback", dataCoverage: output.coverage, result: output.result, error: null });
    return Response.json(result, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (e) { return fail(e instanceof BacktestError ? 422 : 500, e instanceof BacktestError ? e.message : "The preview test could not finish. Try a simpler strategy."); }
}
