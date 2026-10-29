// MOCK M5.23–M5.25 testnet deposit + test pool. Same shapes and error reasons as the server (parsed, so drift fails
// loudly). Never signs or sends anything. QA knob: localStorage "quiver.mock.testnet" = off | off503 | rate | recheck | undeployed.
import * as C from "@/lib/contracts";
import { ApiErr, type QuiverTestnetApi, type TestPoolSide } from "./types";
const POOL = "0x7e57000000000000000000000000000000000001", USDG = "0x7e57000000000000000000000000000000000002", NVDA = "0x7e57000000000000000000000000000000000003";
const SA = "0x5a00000000000000000000000000000000c0ffee";
const knob = () => (typeof localStorage !== "undefined" ? localStorage.getItem("quiver.mock.testnet") : null);
const R = { usdg: 500_000, nvda: 2_500 }; // price ≈ 200 tUSDG per tNVDA
const BAL = { tUSDG: 1_000, tNVDA: 0 }; // the mock wallet's balances
const units = (a: string, d: number) => { const [w, f = ""] = a.split("."); return (BigInt(w) * BigInt(10) ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0")).toString(); };
const dec = (n: number, d = 6) => String(Number(n.toFixed(d)));
const off = () => new ApiErr("venue_unavailable", "The test pool isn’t enabled on this server.", 503, { missing: ["TEST_POOL_ENABLED", "TEST_POOL_ADDRESS"] });
function guard(amount: string, max: number, dp: number) {
  if (knob() === "rate") throw new ApiErr("rate_limited", "Too many requests.", 429, undefined, 12);
  // M5.28 schema-level 422: >18 fraction digits fail AmountStr and details become { reason, issues } (an object, not the issue array).
  if (/^[0-9]+\.[0-9]{19,}$/.test(amount)) throw new ApiErr("validation_failed", "Invalid request.", 422, { reason: "too_many_decimals", issues: [{ path: "/amount", code: "invalid_format", message: "Enter an amount like 0.05." }] });
  if (!C.AmountStr.safeParse(amount).success) throw new ApiErr("validation_failed", "Enter an amount like 0.05.", 422, { reason: "amount_out_of_range" });
  if ((amount.split(".")[1] ?? "").length > dp) throw new ApiErr("validation_failed", `At most ${dp} decimals.`, 422, { reason: "too_many_decimals" });
  const n = Number(amount); if (!(n > 0) || n > max) throw new ApiErr("validation_failed", `Amount must be above 0 and at most ${max.toLocaleString("en-US")}.`, 422, { reason: "amount_out_of_range" });
}
function quote(side: TestPoolSide, amount: string) {
  if (knob() === "off") throw off();
  guard(amount, side === "buy" ? 1_000_000 : 10_000, side === "buy" ? 6 : 18);
  const a = Number(amount) * 0.997, out = side === "buy" ? (R.nvda * a) / (R.usdg + a) : (R.usdg * a) / (R.nvda + a);
  const [si, so, di, dout] = side === "buy" ? ["tUSDG", "tNVDA", 6, 18] as const : ["tNVDA", "tUSDG", 18, 6] as const;
  return C.TestPoolQuoteRes.parse({ side, tokenIn: side === "buy" ? USDG : NVDA, tokenOut: side === "buy" ? NVDA : USDG, symbolIn: si, symbolOut: so,
    amountIn: amount, amountInUnits: units(amount, di), amountOut: dec(out), amountOutUnits: units(dec(out), dout), priceUsdgPerNvda: dec(R.usdg / R.nvda, 4), feeBps: 30,
    reserves: { usdg: units(String(R.usdg), 6), nvda: units(String(R.nvda), 18) }, quotedAt: new Date().toISOString(), testnet: true });
}
const tx = (from: string, to: string, data: string, value = "0") => ({ chainId: 46630 as const, from, to, data, value });
export const mockTestnet: QuiverTestnetApi = {
  async testPoolStatus() {
    if (knob() === "off503") throw off(); // pre-M5.28 servers answered 503 when off; the UI keeps that as a fallback
    if (knob() === "off") return C.TestPoolStatusRes.parse({ enabled: false, chainId: 46630, pool: null, usdg: null, nvda: null, missing: ["TEST_POOL_ENABLED", "TEST_POOL_ADDRESS"], notice: "Test pool is not enabled on this server." });
    return C.TestPoolStatusRes.parse({ enabled: true, chainId: 46630, pool: POOL, usdg: USDG, nvda: NVDA, missing: [], notice: "Testnet only. Test tokens have no value." });
  },
  async testPoolQuote(side, amount) { return quote(side, amount); },
  async testPoolSwapPrepare(b) {
    if (b.chainId !== 46630) throw new ApiErr("validation_failed", "Testnet 46630 only.", 422, { reason: "chain_not_allowed" });
    const q = quote(b.side, b.amount), have = BAL[q.symbolIn as "tUSDG" | "tNVDA"];
    if (Number(b.amount) > have) throw new ApiErr("insufficient_balance", `Your wallet has ${have} ${q.symbolIn}; this swap needs ${b.amount}.`, 422,
      { token: q.tokenIn, symbol: q.symbolIn, have: String(have), need: b.amount, haveUnits: units(String(have), b.side === "buy" ? 6 : 18), needUnits: q.amountInUnits });
    const slip = b.slippageBps ?? 50, min = dec(Number(q.amountOut) * (1 - slip / 10_000));
    return C.TestPoolSwapPrepareRes.parse({
      txs: [{ kind: "approve", tx: tx(b.from, q.tokenIn, "0x095ea7b3" + "00".repeat(64)), description: `Allow the test pool to spend ${b.amount} ${q.symbolIn}` },
        { kind: "swap", tx: tx(b.from, POOL, "0x5c11d795" + "00".repeat(96)), description: `Swap ${b.amount} ${q.symbolIn} for at least ${min} ${q.symbolOut}` }],
      quote: q, minAmountOut: min, minAmountOutUnits: units(min, b.side === "buy" ? 18 : 6), slippageBps: slip, deadline: Math.floor(Date.now() / 1000) + (b.deadlineSec ?? 600),
      testnet: true, notice: "Testnet only. Your wallet signs and sends; Quiver never does." });
  },
  async depositPrepare(b) {
    if (b.chainId !== 46630) throw new ApiErr("validation_failed", "Testnet 46630 only.", 422, { reason: "chain_not_allowed" });
    const k = knob();
    if (k === "recheck") throw new ApiErr("venue_unavailable", "Recipient check failed.", 503, { reason: "recipient_check_unavailable" });
    if (k === "undeployed") throw new ApiErr("conflict", "Smart account not deployed.", 409, { reason: "smart_account_not_deployed", recipient: SA });
    const d = b.asset === "tUSDG" ? 6 : 18; guard(b.amount, b.asset === "ETH" ? 1 : b.asset === "tUSDG" ? 1_000_000 : 10_000, d);
    const u = units(b.amount, d), token = b.asset === "ETH" ? null : b.asset === "tUSDG" ? USDG : NVDA;
    return C.DepositPrepareRes.parse({ tx: token ? tx(b.from, token, "0xa9059cbb" + SA.slice(2).padStart(64, "0") + BigInt(u).toString(16).padStart(64, "0")) : tx(b.from, SA, "0x", u),
      asset: b.asset, amount: b.amount, amountBaseUnits: u, decimals: d, recipient: SA, recipientCode: "verified", token,
      humanReadable: `Send ${b.amount} ${b.asset} to your Quiver smart account on Robinhood Chain testnet`, testnet: true, preparedAt: new Date().toISOString(),
      notice: "Testnet only. Your wallet signs and sends; Quiver never does." });
  },
};
