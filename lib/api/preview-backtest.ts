import { BacktestRes } from "@/lib/contracts";
import { ApiErr, type QuiverApi } from "./types";

export const previewBacktest: QuiverApi["backtest"] = async (body) => {
  const response = await fetch("/api/preview/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new ApiErr("backtest_data_unavailable", data?.message ?? "The preview test could not finish.", response.status);
  return BacktestRes.parse(data);
};
