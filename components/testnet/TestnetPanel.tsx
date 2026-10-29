"use client";
// M5.23–M5.25 Testnet deposit + test-pool swap. The server only PREPARES unsigned txs; the user's own wallet signs and
// sends each one on an explicit click, on chain 46630 only (lib/wallet sendTestnetTx refuses anything else).
// Static end states only — Ellis owns motion via the data-motion hooks.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/Link";
import { api, type DepositAsset, type DepositPrepareRes, type TestPoolQuote, type TestPoolSide, type TestPoolStatus, type TestPoolSwapPrepare } from "@/lib/api";
import { hasWallet, sendTestnetTx, waitReceipt } from "@/lib/wallet";
import { Pill } from "@/components/ui";
import { tnErr, type TnErr } from "./tnErr";

const input = "mt-1 w-full rounded-[10px] border border-line-2 bg-bg px-3 py-2 font-mono text-[13px] text-ink";
const btn = "btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5 disabled:opacity-50";
const btnP = "btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg disabled:opacity-50";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const DP = { ETH: 18, tUSDG: 6, tNVDA: 18 } as const, CAP = { ETH: 1, tUSDG: 1_000_000, tNVDA: 10_000 } as const;
/** Same rules the server applies (AmountStr, per-token decimals and caps), checked before any request. */
function amountErr(a: string, sym: keyof typeof DP): TnErr | null {
  if (!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/.test(a)) return { key: "validation_failed", msg: "Enter an amount like 0.05." };
  if ((a.split(".")[1] ?? "").length > DP[sym]) return { key: "too_many_decimals", msg: `${sym} allows at most ${DP[sym]} decimal places.` };
  if (!(Number(a) > 0) || Number(a) > CAP[sym]) return { key: "amount_out_of_range", msg: `Enter more than 0 and at most ${CAP[sym].toLocaleString("en-US")} ${sym}.` };
  return null;
}
const Tag = () => <span className="rounded-full border border-warn/40 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-warn" data-testid="tn-tag">Testnet</span>;

/** Counts down a 429 wait; returns seconds left (0 = free). */
function useCooldown() {
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft((s) => s - 1), 1000); return () => clearTimeout(t); }, [left]);
  return [left, setLeft] as const;
}
function ErrLine({ e, onRetry, left, testid }: { e: TnErr; onRetry?: () => void; left: number; testid: string }) {
  const calm = e.key === "recipient_check_unavailable" || e.key === "quote_unavailable" || e.key === "rate_limited" || e.off;
  const msg = e.key === "rate_limited" ? (left > 0 ? `Too many requests. Try again in ${left}s.` : "You can try again now.") : e.msg;
  return (
    <p className={`mt-3 text-[13px] ${calm ? "text-muted" : "text-short"}`} data-testid={testid} data-code={e.key} data-motion="tn-error">
      {msg}
      {e.next && "href" in e.next && <> <Link href={e.next.href} className="underline decoration-accent/40 underline-offset-4 hover:decoration-current">{e.next.label}</Link></>}
      {e.next && "retry" in e.next && onRetry && <> <button type="button" onClick={onRetry} className="ml-1 underline decoration-accent/40 underline-offset-4 hover:decoration-current" data-testid={testid + "-retry"}>{e.next.label}</button></>}
    </p>
  );
}
function RecipientBadge({ code }: { code: "verified" | "unchecked" }) {
  return <span data-testid="tn-recipient" data-code={code} data-motion="tn-badge"><Pill tone={code === "verified" ? "long" : "warn"}>{code === "verified" ? "Recipient verified" : "Recipient unchecked"}</Pill></span>;
}
type Step = { label: string; state: "todo" | "signing" | "pending" | "done" | "failed"; hash?: string };
function Steps({ steps }: { steps: Step[] }) {
  const S = { todo: "Not sent", signing: "Check your wallet…", pending: "Waiting to confirm…", done: "Confirmed", failed: "Failed" } as const;
  return (
    <ol className="mt-4 space-y-2" data-motion="tn-steps">
      {steps.map((s, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2 text-[13px]" data-motion="tn-step" data-state={s.state} data-testid="tn-step">
          <span className="min-w-0"><span className="mr-2 font-mono text-muted">{i + 1}.</span>{s.label}</span>
          <span className={`font-mono text-[12px] ${s.state === "done" ? "text-long" : s.state === "failed" ? "text-short" : "text-muted"}`}>{S[s.state]}{s.hash && <> · {short(s.hash)}</>}</span>
        </li>))}
    </ol>
  );
}
function WalletPick({ wallets, from, setFrom, id }: { wallets: string[]; from: string; setFrom: (a: string) => void; id: string }) {
  return (
    <label className="min-w-0 flex-1 basis-[200px] text-[12.5px] text-muted" htmlFor={id}>From (linked wallet)
      <select id={id} value={from} onChange={(e) => setFrom(e.target.value)} className={input}>{wallets.map((w) => <option key={w} value={w}>{short(w)}</option>)}</select>
    </label>
  );
}

function Deposit({ wallets }: { wallets: string[] }) {
  const [asset, setAsset] = useState<DepositAsset>("ETH"), [amount, setAmount] = useState("0.01"), [from, setFrom] = useState(wallets[0] ?? "");
  const [res, setRes] = useState<DepositPrepareRes | null>(null), [err, setErr] = useState<TnErr | null>(null), [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step | null>(null), [left, setLeft] = useCooldown();
  const prepare = async () => {
    setErr(null); setRes(null); setStep(null);
    const pre = amountErr(amount.trim(), asset); if (pre) { setErr(pre); return; }
    setBusy(true);
    try { const r = await api.depositPrepare({ chainId: 46630, asset, amount: amount.trim(), from }); setRes(r); setStep({ label: r.humanReadable, state: "todo" }); }
    catch (x) {
      const e = tnErr(x);
      // A per-token address still unset reads as a venue outage; say which token, and that ETH still works.
      setErr(e.off && asset !== "ETH" ? { key: "token_unavailable", msg: `${asset} isn’t set up on this server yet. ETH deposits still work.` } : e.off ? { key: "venue_unavailable", msg: "Testnet deposits are unavailable on this server right now." } : e);
      if (e.waitSec) setLeft(e.waitSec);
    } finally { setBusy(false); }
  };
  const send = async () => { // explicit click only
    if (!res) return;
    setErr(null); setStep((s) => s && { ...s, state: "signing" });
    try { const h = await sendTestnetTx(res.tx); setStep((s) => s && { ...s, state: "pending", hash: h }); const ok = await waitReceipt(h); setStep((s) => s && { ...s, state: ok === false ? "failed" : ok ? "done" : "pending" }); }
    catch (x) { setStep((s) => s && { ...s, state: "todo" }); setErr(tnErr(x)); }
  };
  if (!wallets.length) return <p className="text-[14px] text-muted" data-testid="tn-nowallet">Link a wallet first; deposits come from your own wallet. <Link href="#linked" className="underline decoration-accent/40 underline-offset-4 hover:decoration-current">Link a wallet</Link></p>;
  return (
    <div data-testid="tn-deposit" data-motion="tn-deposit">
      <form onSubmit={(e) => { e.preventDefault(); prepare(); }} className="flex flex-wrap items-end gap-3">
        <label className="w-[110px] text-[12.5px] text-muted" htmlFor="tn-asset">Asset
          <select id="tn-asset" value={asset} onChange={(e) => { setAsset(e.target.value as DepositAsset); setRes(null); }} className={input}>{(["ETH", "tUSDG", "tNVDA"] as const).map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        <label className="min-w-0 flex-1 basis-[120px] text-[12.5px] text-muted" htmlFor="tn-amt">Amount
          <input id="tn-amt" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); setRes(null); }} className={input} data-testid="tn-amt" />
        </label>
        <WalletPick wallets={wallets} from={from} setFrom={(a) => { setFrom(a); setRes(null); }} id="tn-from" />
        <button disabled={busy || left > 0 || !amount.trim()} className={btn} data-testid="tn-prepare">{busy ? "Preparing…" : "Prepare deposit"}</button>
      </form>
      <div aria-live="polite">
        {err && <ErrLine e={err} onRetry={prepare} left={left} testid="tn-err" />}
        {res && step && (
          <div className="mt-4 rounded-[12px] border border-line p-4" data-testid="tn-prepared" data-motion="tn-prepared">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13.5px]">To your smart account <span className="font-mono">{short(res.recipient)}</span></span><RecipientBadge code={res.recipientCode} /></div>
            {res.recipientCode === "unchecked" && <p className="mt-2 text-[12.5px] text-muted">This server has no testnet RPC, so it couldn’t confirm the account exists. Check the address in your wallet before sending.</p>}
            <Steps steps={[step]} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {step.state !== "done" && <button type="button" onClick={send} disabled={step.state === "signing" || step.state === "pending" || !hasWallet()} className={btnP} data-testid="tn-send">Sign in wallet</button>}
              {!hasWallet() && <span className="text-[12.5px] text-muted">No browser wallet found.</span>}
            </div>
            <p className="mt-3 text-[12px] text-muted">{res.notice}</p>
          </div>)}
      </div>
    </div>
  );
}

function Swap({ wallets }: { wallets: string[] }) {
  const [side, setSide] = useState<TestPoolSide>("buy"), [amount, setAmount] = useState("100"), [from, setFrom] = useState(wallets[0] ?? "");
  const [q, setQ] = useState<TestPoolQuote | null>(null), [prep, setPrep] = useState<TestPoolSwapPrepare | null>(null), [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<TnErr | null>(null), [busy, setBusy] = useState(false), [left, setLeft] = useCooldown();
  const seq = useRef(0);
  const fail = (x: unknown) => { const e = tnErr(x); setErr(e); if (e.waitSec) setLeft(e.waitSec); };
  const quote = useCallback(async () => {
    const n = ++seq.current; setErr(null);
    if (!/^\d+(\.\d+)?$/.test(amount.trim()) || Number(amount) <= 0) { setQ(null); return; }
    try { const r = await api.testPoolQuote(side, amount.trim()); if (n === seq.current) setQ(r); } catch (x) { if (n === seq.current) { setQ(null); fail(x); } }
  }, [side, amount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (left > 0) return; const t = setTimeout(quote, 400); return () => clearTimeout(t); }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps
  const prepare = async () => {
    setErr(null); setPrep(null);
    const pre = amountErr(amount.trim(), side === "buy" ? "tUSDG" : "tNVDA"); if (pre) { setErr(pre); return; }
    setBusy(true);
    try { const r = await api.testPoolSwapPrepare({ chainId: 46630, side, amount: amount.trim(), from }); setPrep(r); setQ(r.quote); setSteps(r.txs.map((t) => ({ label: t.description, state: "todo" }))); }
    catch (x) { fail(x); } finally { setBusy(false); }
  };
  const next = steps.findIndex((s) => s.state !== "done");
  const sendNext = async () => { // one tx per click, strictly in order (approve before swap)
    if (!prep || next < 0) return; const i = next;
    const set = (p: Partial<Step>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...p } : s)));
    setErr(null); set({ state: "signing" });
    try { const h = await sendTestnetTx(prep.txs[i].tx); set({ state: "pending", hash: h }); const ok = await waitReceipt(h); set({ state: ok === false ? "failed" : ok ? "done" : "pending" }); }
    catch (x) { set({ state: "todo" }); setErr(tnErr(x)); }
  };
  const inSym = side === "buy" ? "tUSDG" : "tNVDA", outSym = side === "buy" ? "tNVDA" : "tUSDG";
  const cur = next >= 0 ? steps[next] : null;
  return (
    <div data-testid="tn-swap" data-motion="tn-swap">
      <div role="radiogroup" aria-label="Side" className="inline-flex rounded-full border border-line-2 p-0.5 text-[12.5px]">
        {(["buy", "sell"] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={side === s} onClick={() => { setSide(s); setPrep(null); setSteps([]); }} className={`rounded-full px-3 py-1 ${side === s ? "bg-white/10 text-ink" : "text-muted"}`} data-testid={"tn-side-" + s}>{s === "buy" ? "Buy tNVDA" : "Sell tNVDA"}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); prepare(); }} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-[120px] text-[12.5px] text-muted" htmlFor="tp-amt">You pay ({inSym})
          <input id="tp-amt" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); setPrep(null); setSteps([]); }} className={input} data-testid="tp-amt" />
        </label>
        {wallets.length > 0 && <WalletPick wallets={wallets} from={from} setFrom={setFrom} id="tp-from" />}
        <button disabled={busy || left > 0 || !wallets.length || !q} className={btn} data-testid="tp-prepare">{busy ? "Preparing…" : "Prepare swap"}</button>
      </form>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4" data-testid="tp-quote" data-motion="tn-quote">
        <div><dt className="text-muted">You get</dt><dd className="tnum font-mono" data-motion="tick" key={q?.amountOut ?? "-"}>{q ? `${q.amountOut} ${outSym}` : "—"}</dd></div>
        <div><dt className="text-muted">Price</dt><dd className="tnum font-mono">{q ? `${q.priceUsdgPerNvda} tUSDG` : "—"}</dd></div>
        <div><dt className="text-muted">Fee</dt><dd className="tnum font-mono">{q ? `${(q.feeBps / 100).toFixed(2)}%` : "—"}</dd></div>
        <div><dt className="text-muted">Min. received</dt><dd className="tnum font-mono">{prep ? `${prep.minAmountOut} ${outSym}` : "—"}</dd></div>
      </dl>
      {!wallets.length && <p className="mt-3 text-[13px] text-muted">Link a wallet to swap. <Link href="#linked" className="underline decoration-accent/40 underline-offset-4 hover:decoration-current">Link a wallet</Link></p>}
      <div aria-live="polite">
        {err && <ErrLine e={err} onRetry={prep ? sendNext : quote} left={left} testid="tp-err" />}
        {prep && (
          <div className="mt-4 rounded-[12px] border border-line p-4" data-testid="tp-prepared" data-motion="tn-prepared">
            <Steps steps={steps} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {cur && <button type="button" onClick={sendNext} disabled={cur.state === "signing" || cur.state === "pending" || !hasWallet()} className={btnP} data-testid="tp-send">{prep.txs[next].kind === "approve" ? "Approve in wallet" : "Swap in wallet"}</button>}
              {!cur && <span className="text-[13px] text-long" data-testid="tp-done">Swap confirmed on testnet.</span>}
              {!hasWallet() && <span className="text-[12.5px] text-muted">No browser wallet found.</span>}
            </div>
            <p className="mt-3 text-[12px] text-muted">{prep.notice}</p>
          </div>)}
      </div>
    </div>
  );
}

/** Wallets page section: Testnet deposit + test pool. `wallets` = the caller's linked EVM addresses. */
export default function TestnetPanel() {
  const [st, setSt] = useState<TestPoolStatus | null>(null), [stErr, setStErr] = useState<TnErr | null>(null);
  const [wallets, setWallets] = useState<string[] | null>(null), [wErr, setWErr] = useState<TnErr | null>(null);
  const loadWallets = useCallback(() => api.myWallets().then((r) => { setWErr(null); setWallets(r.items.map((w) => w.address).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))); }, (x) => setWErr(tnErr(x))), []);
  useEffect(() => { api.testPoolStatus().then(setSt, (x) => setStErr(tnErr(x))); loadWallets(); }, [loadWallets]);
  const off = stErr?.off || (st && !st.enabled);
  return (
    <section aria-labelledby="tn-h" data-motion="tn-section">
      <h2 className="mt-12 flex items-center gap-3 text-[15px] font-medium" id="tn-h">Testnet deposit &amp; test pool <Tag /></h2>
      <p className="mt-2 max-w-[62ch] text-[13.5px] text-muted">Robinhood Chain testnet (46630) only. Test tokens have no value. Quiver prepares each transaction; your wallet signs and sends it, one click at a time.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[16px] border border-line p-6" id="tn-deposit">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Deposit to your smart account</span><Tag /></div>
          <div className="mt-4">{wErr ? <ErrLine e={wErr} left={0} testid="tn-w-err" /> : !wallets ? <p className="text-[13px] text-muted">Loading your wallets…</p> : <Deposit key={wallets.join()} wallets={wallets} />}</div>
          {wallets && !wallets.length && <button type="button" onClick={loadWallets} className={btn + " mt-3"} data-testid="tn-refresh">I’ve linked one — refresh</button>}
        </div>
        <div className="rounded-[16px] border border-line p-6" data-testid="tn-pool">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Test pool · tUSDG / tNVDA</span><Tag /></div>
          <div className="mt-4">
            {!st && !stErr ? <p className="text-[13px] text-muted">Checking the test pool…</p>
              : off ? <div data-testid="tp-off" data-motion="tn-off"><p className="text-[14px]">Test pool not enabled</p><p className="mt-1 text-[13px] text-muted">This server hasn’t switched the test pool on yet. Deposits of ETH still work.</p></div>
              : stErr ? <ErrLine e={stErr} left={0} testid="tp-st-err" />
              : wallets ? <Swap key={wallets.join()} wallets={wallets} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
