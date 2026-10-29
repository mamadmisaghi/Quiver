"use client";
// QA P1: the live-mode way out of "Sign in to load your data." M5.2: GET /auth/config picks Privy or the dev login.
// A 503 auth_unavailable (server has no Privy keys yet) is shown as a calm status, not an error.
import dynamic from "next/dynamic";
import { useState } from "react";
import { signIn, signInAvailable } from "@/lib/api/live";
import { ApiErr, errCopy } from "@/lib/api";
import { useAuthConfig } from "@/lib/auth/useAuthConfig";
const PrivyLogin = dynamic(() => import("./auth/PrivyLogin"), { ssr: false, loading: () => <span className="inline-block h-9 w-24 animate-pulse rounded-full bg-white/[.06]" /> });

export default function SignInButton({ onDone }: { onDone?: () => void }) {
  const { cfg, privyAppId } = useAuthConfig();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; calm: boolean } | null>(null);
  if (privyAppId) return <PrivyLogin appId={privyAppId} onDone={onDone} />;
  const dev = signInAvailable && (cfg ? cfg.devLogin : true);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await signIn(); onDone?.(); } catch (x) {
      const calm = x instanceof ApiErr && x.code === "auth_unavailable";
      setErr({ calm, msg: x instanceof ApiErr ? (x.code === "unauthorized" ? x.message : errCopy(x.code, x.message)) : "Couldn't sign in. Try again." });
    }
    setBusy(false);
  };
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <button type="button" onClick={go} disabled={busy || !dev} aria-busy={busy}
        className="btn rounded-full bg-accent px-5 py-2 text-[13.5px] font-medium text-bg hover:brightness-110 active:bg-accent-press disabled:opacity-60">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {!dev && <span className="text-[12.5px] text-muted" data-testid="auth-calm">Sign-in isn’t switched on for this preview yet. You can still explore with example data.</span>}
      {err && <span role={err.calm ? "status" : "alert"} className={`max-w-[22rem] text-center text-[12.5px] ${err.calm ? "text-muted" : "text-short"}`} data-testid={err.calm ? "auth-calm" : undefined}>{err.msg}</span>}
    </span>
  );
}
