"use client";
// M5.13 read-only testnet account check (Robinhood Chain testnet 46630). The tag shows whose RPC served it (x-quiver-rpc).
import { useState } from "react";
import Link from "@/components/Link";
import { api, ApiErr, errCopy, type ChainAccountRead } from "@/lib/api";
import { Pill } from "@/components/ui";
const eth = (wei: string) => { const E = BigInt("1000000000000000000"), b = BigInt(wei), w = b / E, f = (b % E).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, ""); return w.toLocaleString("en-US") + (f ? "." + f : ""); };
const ERR: Record<string, string> = {
  venue_unavailable: "Testnet reads are off on this server right now.",
  rpc_url_blocked: "Your saved RPC now points at a private address, so nothing was sent. Update it in Settings.",
  validation_failed: "That isn’t an EVM address (0x + 40 hex characters).",
};
const CODE: Record<string, string> = { match: "Quiver session account", mismatch: "Unrecognised contract", unchecked: "Contract (unchecked)", no_code: "Plain wallet" };
export default function ChainAccountCard({ initial }: { initial?: string }) {
  const [addr, setAddr] = useState(initial ?? "");
  const [r, setR] = useState<ChainAccountRead | null>(null);
  const [err, setErr] = useState<{ code: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (e: React.FormEvent) => {
    e.preventDefault(); const a = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { setR(null); setErr({ code: "validation_failed", msg: ERR.validation_failed }); return; }
    setBusy(true); setErr(null);
    try { setR(await api.chainAccount(a)); }
    catch (x) { setR(null); const c = x instanceof ApiErr ? x.code : "internal"; setErr({ code: c, msg: ERR[c] ?? (x instanceof ApiErr ? errCopy(x.code, x.message) : "Couldn’t read the account.") }); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="chain-account">
      <form onSubmit={read} className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-[240px] text-[12.5px] text-muted">Address on testnet (46630)
          <input value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" className="mt-1 w-full rounded-[10px] border border-line-2 bg-bg px-3 py-2 font-mono text-[13px] text-ink" data-testid="ca-addr" />
        </label>
        <button disabled={busy} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5 disabled:opacity-50" data-testid="ca-read">{busy ? "Reading…" : "Read"}</button>
      </form>
      <div aria-live="polite">
        {err && <p className={`mt-3 text-[13px] ${err.code === "venue_unavailable" ? "text-muted" : "text-short"}`} data-testid="ca-err" data-code={err.code}>{err.msg}{err.code === "rpc_url_blocked" && <> <Link href="/app/settings#secrets" className="underline">Settings</Link></>}</p>}
        {r && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4" data-testid="ca-res">
          <div><dt className="text-muted">Balance</dt><dd className="tnum font-mono">{eth(r.res.nativeBalanceWei)} ETH</dd></div>
          <div><dt className="text-muted">Block</dt><dd className="tnum font-mono">{r.res.blockNumber}</dd></div>
          <div><dt className="text-muted">Type</dt><dd>{CODE[r.res.codeCheck]}</dd></div>
          <div><dt className="text-muted">Source</dt><dd data-testid="ca-rpc" data-rpc={r.rpc ?? ""}>{r.rpc === "user" ? <Pill tone="accent">Using your RPC</Pill> : r.rpc === "server" ? <Pill>Quiver RPC</Pill> : "—"}</dd></div>
        </dl>}
      </div>
    </div>
  );
}
