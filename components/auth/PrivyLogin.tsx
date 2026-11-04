"use client";
import { useState } from "react";
import { useTradingWallets } from "./WalletRuntime";
/** SignInButton retains the appId prop for backward compatibility; the app has one configured Privy root. */
export default function PrivyLogin({ onDone }: { appId: string; onDone?: () => void }) {
  const wallet = useTradingWallets(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await wallet.login();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in could not finish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={!wallet.ready || wallet.provider !== "privy" || busy}
        aria-busy={busy}
        onClick={() => void signIn()}
        className="btn rounded-full bg-accent px-5 py-2 text-[13.5px] font-medium text-bg hover:brightness-110 active:bg-accent-press disabled:opacity-60"
        data-testid="privy-login"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && (
        <span role="alert" className="max-w-[22rem] text-center text-[12.5px] text-short">
          {error}
        </span>
      )}
    </span>
  );
}
