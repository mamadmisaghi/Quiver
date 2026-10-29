"use client";
// M5.2 wallet link: challenge → personal_sign (on a click) → verify. Lists GET /me/wallets; unlink asks first.
// The server checks the EIP-191 signature; the web never signs on its own and never sees a key.
import { useCallback, useEffect, useState } from "react";
import { api, ApiErr, reasonOf, errCopy, type LinkedWallet, type WalletLinkChallenge } from "@/lib/api";
import { connect, personalSign, hasWallet, WalletErr } from "@/lib/wallet";
import SignInButton from "@/components/SignInButton";
import { onSession } from "@/lib/api/session";
import { useAuthConfig } from "@/lib/auth/useAuthConfig";
const UNAVAILABLE = "Wallet linking isn’t available yet.";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const btn = "btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110 disabled:opacity-40";
const ghost = "btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 disabled:opacity-40";
const inUse = (x: unknown) => x instanceof ApiErr && x.status === 409 && reasonOf(x) === "wallet_in_use";
// M5.10: 409 wallet_in_use at challenge or verify
const say = (x: unknown) => (x instanceof WalletErr ? x.message : inUse(x) ? "This wallet is already linked to another Quiver account. Unlink it there first, or use a different wallet." : x instanceof ApiErr ? errCopy(x.code, x.message) : "Something went wrong. Nothing was linked.");

export default function LinkedWallets({ compact = false, max = 5 }: { compact?: boolean; max?: number }) {
  const [items, setItems] = useState<LinkedWallet[] | null>(null);
  const [auth, setAuth] = useState(true);
  const [ch, setCh] = useState<(WalletLinkChallenge & { address: string }) | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // M5.11: walletLink.enabled=false (or a 503 wallet_link_unavailable) hides every "Link wallet" control; unlinking still works.
  const { cfg } = useAuthConfig();
  const [off503, setOff503] = useState(false);
  const linkOff = cfg?.walletLink.enabled === false || off503;
  const load = useCallback(() => api.myWallets().then((r) => { setItems(r.items); setAuth(true); }).catch((x) => { if (x instanceof ApiErr && x.status === 401) setAuth(false); else setErr(say(x)); }), []);
  useEffect(() => { load(); return onSession(load); }, [load]);
  const act = async (f: () => Promise<void>) => { setBusy(true); setErr(null); setOk(null); try { await f(); } catch (x) { if (x instanceof ApiErr && x.code === "wallet_link_unavailable") { setCh(null); setOff503(true); } else setErr(say(x)); } finally { setBusy(false); } };
  const start = () => act(async () => { const a = await connect(); const c = await api.walletLinkChallenge(a); setCh({ ...c, address: a }); });
  const sign = () => act(async () => {
    const c = ch!; setCh(null); // the nonce is single-use either way
    const sig = await personalSign(c.address, c.message);
    const r = await api.walletLinkVerify({ nonce: c.nonce, signature: sig }); setItems(r.items); setOk(`Linked ${short(c.address)}.`);
  });
  const unlink = (a: string) => act(async () => { const r = await api.unlinkWallet(a); setItems(r.items); setConfirm(null); setOk(`Unlinked ${short(a)}.`); });

  if (!auth) return <div className="text-[13.5px] text-muted" data-testid="lw-signin"><p className="mb-3">{linkOff ? "Sign in to see your linked wallets." : "Sign in to link a wallet."}</p><SignInButton /></div>;
  return (
    <div data-testid="linked-wallets" className="text-[13.5px]">
      {items == null ? <div className="h-10 animate-pulse rounded-[8px] bg-white/[.04]" role="status" aria-label="Loading wallets" />
        : items.length ? <ul className="divide-y divide-line" data-testid="lw-list">{items.map((w) => (
          <li key={w.address} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="flex min-w-0 items-center gap-2"><span className="font-mono">{short(w.address)}</span>{w.primary && <span className="text-[12px] text-muted">Primary</span>}</span>
            {confirm === w.address
              ? <span role="alertdialog" aria-label={`Unlink ${short(w.address)}?`} className="flex items-center gap-2"><span className="text-[12.5px] text-muted">Unlink?</span>
                  <button type="button" className="btn rounded-full border border-short/50 px-3 py-1 text-[12.5px] text-short hover:bg-short/10" disabled={busy} onClick={() => unlink(w.address)} data-testid="lw-unlink-confirm">Unlink</button>
                  <button type="button" className="btn rounded-full px-3 py-1 text-[12.5px] text-muted hover:text-ink" onClick={() => setConfirm(null)}>Cancel</button></span>
              : <button type="button" className="btn text-[12.5px] text-muted hover:text-ink" onClick={() => setConfirm(w.address)} data-testid="lw-unlink">Unlink</button>}
          </li>))}</ul>
        : <p className="text-muted">No wallets linked. {compact || linkOff ? "" : "Linking proves you own an address; it doesn’t move funds or grant spending."}</p>}
      {linkOff ? <p className="mt-3 text-[12.5px] text-muted" role="status" data-testid="lw-unavailable">{UNAVAILABLE}</p> : <div className="mt-3 flex flex-wrap items-center gap-2">
        {ch ? <>
            <button type="button" className={btn} disabled={busy} onClick={sign} data-testid="lw-sign">{busy ? "Check your wallet…" : "Sign in wallet"}</button>
            <button type="button" className={ghost} disabled={busy} onClick={() => setCh(null)}>Cancel</button>
          </>
          : <button type="button" className={compact ? ghost : btn} disabled={busy || (items?.length ?? 0) >= max} onClick={start} data-testid="lw-link">{busy ? "Waiting for wallet…" : hasWallet() ? "Link a wallet" : "Link a browser wallet"}</button>}
      </div>}
      {ch && <p className="mt-2 text-[12.5px] text-muted" data-testid="lw-challenge">Your wallet will ask you to sign a message for {short(ch.address)}. It costs no gas and moves no funds. <span data-testid="lw-expiry">Sign before {new Date(ch.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> on chain {ch.chainId} ({ch.domain}).</p>}
      {err && <p role="alert" className="mt-2 text-[12.5px] text-short" data-testid="lw-err">{err}</p>}
      {ok && <p role="status" className="mt-2 text-[12.5px] text-long" data-testid="lw-ok">{ok}</p>}
    </div>
  );
}
