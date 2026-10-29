"use client";
// M5.2 account menu + connect-wallet entry in the shell. Opens a small popover with linked wallets (link/unlink).
import Link from "@/components/Link";
import { useEffect, useRef, useState } from "react";
import LinkedWallets from "./LinkedWallets";
import { useAuthConfig } from "@/lib/auth/useAuthConfig";

export default function AccountMenu({ tall = false }: { tall?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const linkOff = useAuthConfig().cfg?.walletLink.enabled === false; // M5.11: no wallet-link wording when the server has it off
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", k); addEventListener("mousedown", c);
    return () => { removeEventListener("keydown", k); removeEventListener("mousedown", c); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} data-testid="connect-wallet"
        className={`btn w-full rounded-full border border-line-2 hover:border-white/30 hover:bg-white/5 ${tall ? "min-h-11 text-[13.5px]" : "py-2 text-[13px]"}`}>{linkOff ? "Account" : "Connect wallet"}</button>
      {open && <div role="dialog" aria-label="Account" data-testid="account-menu" data-motion="pop"
        className="absolute bottom-full left-0 z-50 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-[12px] border border-line-2 bg-bg-2 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><span className="font-medium">Account</span><span className="text-[12px] text-muted">Testnet 46630</span></div>
        <LinkedWallets compact />
        <div className="mt-4 flex gap-4 border-t border-line pt-3 text-[12.5px]"><Link href="/app/wallets" className="text-muted hover:text-ink" onClick={() => setOpen(false)}>Wallets</Link><Link href="/app/settings" className="text-muted hover:text-ink" onClick={() => setOpen(false)}>Settings</Link></div>
      </div>}
    </div>
  );
}
