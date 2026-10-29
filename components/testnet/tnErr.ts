// M5.23–M5.25: one place that turns testnet/test-pool errors into calm copy + a next step. Branch on code and
// details.reason only, never on message text.
import { ApiErr, detailsOf } from "@/lib/api";
import { WalletErr } from "@/lib/wallet";
export type Next = { label: string; href: string } | { label: string; retry: true };
export type TnErr = { key: string; msg: string; next?: Next; waitSec?: number; off?: boolean };
type D = { reason?: string; recipient?: string; symbol?: string; have?: string; need?: string; missing?: string[] };
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export function tnErr(e: unknown): TnErr {
  if (e instanceof WalletErr) return { key: "wallet_" + e.kind, msg: e.message };
  if (!(e instanceof ApiErr)) return { key: "internal", msg: "Something went wrong. Nothing was sent." };
  const dd = detailsOf(e.details), d = dd.obj as D, r = dd.reason;
  // Server copy for amount 422s is specific ("tUSDG has 6 decimals.", "…at most 1 ETH."); the schema-level one is generic.
  const own = e.message && !/^Invalid (request|query)\.?$/.test(e.message) ? e.message : null;
  if (e.status === 429 || e.code === "rate_limited") { const w = Math.max(1, Math.ceil(e.retryAfterSec ?? 10)); return { key: "rate_limited", msg: `Too many requests. Try again in ${w}s.`, waitSec: w }; }
  if (e.code === "unauthorized") return { key: "unauthorized", msg: "Sign in to use testnet deposits and the test pool." };
  if (e.code === "insufficient_balance") return { key: "insufficient_balance", msg: `You have ${d.have ?? "0"} ${d.symbol ?? ""}, need ${d.need ?? "more"}.`.replace(/\s+,/, ","), next: { label: "Deposit or lower the amount", href: "#tn-deposit" } };
  if (r === "chain_not_allowed") return { key: r, msg: "Only Robinhood Chain testnet (46630) is allowed here." };
  if (r === "amount_out_of_range") return { key: r, msg: own ?? "That amount is out of range. Limits: 1 ETH, 1,000,000 tUSDG, 10,000 tNVDA." };
  if (r === "too_many_decimals") return { key: r, msg: own ?? "Too many decimal places. tUSDG allows 6, ETH and tNVDA allow 18." };
  if (r === "wallet_not_linked") return { key: r, msg: "That wallet isn’t linked to your account yet.", next: { label: "Link it", href: "#linked" } };
  if (r === "no_smart_account") return { key: r, msg: "You don’t have a testnet smart account yet. It’s created when you take a run to testnet.", next: { label: "Pick a run", href: "/app/portfolio" } };
  if (r === "smart_account_not_deployed") return { key: r, msg: `Your smart account ${short(d.recipient)} isn’t deployed yet. Finish the install step on your run, then deposit.`, next: { label: "Open your runs", href: "/app/portfolio" } };
  if (r === "recipient_check_unavailable") return { key: r, msg: "Couldn’t verify the recipient right now. Try again shortly.", next: { label: "Retry", retry: true } };
  if (e.code === "quote_unavailable") return { key: "quote_unavailable", msg: "No quote right now. Try again shortly.", next: { label: "Retry", retry: true } };
  if (e.code === "venue_unavailable") return d.missing?.length || e.status === 503 ? { key: "venue_unavailable", msg: "Test pool not enabled on this server.", off: true } : { key: "venue_unavailable", msg: "Testnet is unavailable right now." };
  if (e.code === "validation_failed") return { key: "validation_failed", msg: own ?? "Check the amount and try again." };
  if (e.code === "conflict") return { key: "conflict", msg: e.message || "That didn’t go through. Try again." };
  return { key: e.code, msg: e.message || "Something went wrong. Nothing was sent." };
}
