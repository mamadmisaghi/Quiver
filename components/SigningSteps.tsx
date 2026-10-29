"use client";
// M3.9: session-key signing after POST /session-keys/prepare. One button per step, nothing is sent on its own:
// 1 connect + network check (switch to 0xb626 if needed) → 2 eth_signTypedData_v4 → 3 wallet_sendCalls install
// (eth_sendTransaction fallback) → 4 POST /session-keys/submit, then poll GET /session-keys/:id until active.
import { useEffect, useState } from "react";
import { api, ApiErr, type PrepareSessionKeyRes, type SessionKey } from "@/lib/api";
import { connect, ensureChain, signTypedData, sendInstall, hasWallet, WalletErr, TESTNET_CHAIN_HEX } from "@/lib/wallet";

type Step = "connect" | "sign" | "install" | "submit" | "waiting" | "active" | "unavailable";
const ORDER: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect wallet" }, { id: "sign", label: "Sign the key’s terms" },
  { id: "install", label: "Install on your account" }, { id: "submit", label: "Activate" },
];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const btn = "btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110 disabled:opacity-40";

export default function SigningSteps({ prep, onActive }: { prep: PrepareSessionKeyRes; onActive: (k: SessionKey) => void }) {
  const [step, setStep] = useState<Step>("connect");
  const [owner, setOwner] = useState<string | null>(null);
  const [wrongChain, setWrongChain] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const expected = prep.install.params[0].from;

  const act = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await f(); }
    catch (x) {
      if (x instanceof ApiErr && x.code === "signing_unavailable") { setStep("unavailable"); return; }
      setErr(x instanceof WalletErr ? x.message : x instanceof ApiErr ? (x.code === "session_key_policy_hash_mismatch" ? "These terms changed since you prepared them. Close this and prepare again." : x.message) : "Something went wrong. Nothing was sent.");
    } finally { setBusy(false); setMsg(null); }
  };
  const doConnect = () => act(async () => {
    const a = await connect();
    if (a.toLowerCase() !== expected.toLowerCase()) throw new WalletErr("failed", `Your wallet is on ${short(a)}, but this key is for ${short(expected)}. Switch accounts in your wallet and try again.`);
    setOwner(a);
    try { await ensureChain(); setWrongChain(false); setStep("sign"); }
    catch (x) { setWrongChain(true); throw x; }
  });
  const doSwitch = () => act(async () => { await ensureChain(); setWrongChain(false); setStep("sign"); });
  const doSign = () => act(async () => { const s = await signTypedData(owner!, prep.signatureRequest.data); if (!/^0x[0-9a-fA-F]{130}$/.test(s)) throw new WalletErr("failed", "The wallet returned an unexpected signature."); setSig(s); setStep("install"); });
  const doInstall = () => act(async () => { const r = await sendInstall(prep.install as never, setMsg); setTx(r.txHash); setStep("submit"); });
  const doSubmit = () => act(async () => {
    const k = await api.submitSessionKey({ sessionKeyId: prep.sessionKeyId, signature: sig!.toLowerCase(), policyHash: prep.policyHash, ...(tx ? { installTxHash: tx.toLowerCase() } : {}) });
    if (k.status === "active") { setStep("active"); onActive(k); } else setStep("waiting");
  });
  useEffect(() => { // polling is a read; the only write (submit) was clicked
    if (step !== "waiting") return; let on = true; let n = 0;
    const tick = async () => {
      try { const k = await api.sessionKey(prep.sessionKeyId); if (!on) return; if (k.status === "active") { setStep("active"); onActive(k); return; } if (k.status !== "pending") { setErr(`The key is ${k.status}. Prepare a new one to try again.`); return; } } catch { /* keep polling */ }
      if (on && ++n < 60) setTimeout(tick, 3000); else if (on) setErr("Still waiting for the install to confirm. Check back in a minute.");
    };
    tick(); return () => { on = false; };
  }, [step, prep.sessionKeyId, onActive]);

  if (step === "unavailable") return (
    <div className="mt-3 rounded-[10px] border border-line-2 p-3 text-[12.5px]" role="status" data-testid="sk-unavailable">
      <div className="text-ink-2">Signing isn’t available yet</div>
      <div className="mt-1 text-muted">Quiver can’t check wallet signatures on this server yet. Nothing was installed and no funds moved. Keep paper trading for now.</div>
    </div>);
  const idx = step === "waiting" || step === "active" ? ORDER.length : ORDER.findIndex((s) => s.id === step);
  return (
    <div className="mt-3 rounded-[10px] border border-accent/30 p-3" data-testid="sk-steps" data-step={step}>
      <div className="text-[12.5px] text-ink-2">Key prepared. It can:</div>
      <ul className="mt-1 grid gap-1 text-[12.5px] text-muted">{prep.humanReadable.map((l) => <li key={l}>— {l}</li>)}</ul>
      <ol className="mt-3 grid gap-1.5 text-[12.5px]" aria-label="Signing steps">
        {ORDER.map((s, i) => {
          const st = i < idx ? "done" : i === idx ? "current" : "todo";
          return <li key={s.id} aria-current={st === "current" ? "step" : undefined} className={`flex items-center gap-2 ${st === "todo" ? "text-muted" : "text-ink-2"}`}>
            <span aria-hidden className={`grid size-4 place-items-center rounded-full border text-[10px] tabular-nums ${st === "done" ? "border-accent bg-accent text-bg" : st === "current" ? "border-accent text-accent" : "border-line-2"}`}>{st === "done" ? "✓" : i + 1}</span>
            {s.label}<span className="sr-only"> — {st === "done" ? "done" : st === "current" ? "current step" : "not started"}</span>
            {s.id === "connect" && owner && <span className="font-mono text-muted">{short(owner)}</span>}
            {s.id === "install" && tx && <span className="font-mono text-muted">{short(tx)}</span>}
          </li>;
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {step === "connect" && !wrongChain && <button className={btn} disabled={busy} onClick={doConnect}>{busy ? "Waiting for wallet…" : hasWallet() ? "Connect wallet" : "Connect a browser wallet"}</button>}
        {step === "connect" && wrongChain && <button className={btn} disabled={busy} onClick={doSwitch}>{busy ? "Waiting for wallet…" : "Switch to Robinhood Chain testnet"}</button>}
        {step === "sign" && <button className={btn} disabled={busy} onClick={doSign}>{busy ? "Check your wallet…" : "Sign in wallet"}</button>}
        {step === "install" && <button className={btn} disabled={busy} onClick={doInstall}>{busy ? msg ?? "Check your wallet…" : "Send install transaction"}</button>}
        {step === "submit" && <button className={btn} disabled={busy} onClick={doSubmit}>{busy ? "Activating…" : "Activate key"}</button>}
        {step === "waiting" && !err && <span role="status" className="text-[12.5px] text-muted">Waiting for the key to become active…</span>}
        {step === "active" && <span role="status" className="text-[12.5px] text-long" data-testid="sk-active">Session key active. You can continue to live.</span>}
        {step === "install" && <span className="text-[12px] text-muted">Testnet gas only · chain {parseInt(TESTNET_CHAIN_HEX, 16)}</span>}
      </div>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-short" data-testid="sk-step-err">{err}</p>}
    </div>
  );
}
