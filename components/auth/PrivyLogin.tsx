"use client";
// M5.2: Privy login, loaded only when GET /auth/config says privy.enabled (see SignInButton). Privy hands us an identity
// token; the server verifies it (ES256, iss/aud) on POST /auth/exchange. No keys live in the web app.
import { useEffect, useRef, useState } from "react";
import { PrivyProvider, useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { signInWithPrivy } from "@/lib/api/live";
import { ApiErr, errCopy } from "@/lib/api";
import { ROBINHOOD_TESTNET } from "@/lib/auth/chain";

function Inner({ onDone }: { onDone?: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated || !identityToken || sent.current === identityToken) return;
    sent.current = identityToken;
    signInWithPrivy(identityToken).then(() => onDone?.()).catch((x) => setErr(x instanceof ApiErr ? errCopy(x.code, x.message) : "Couldn’t sign in. Try again.")).finally(() => setBusy(false));
  }, [authenticated, identityToken, onDone]);
  return (
    <span className="inline-flex flex-col items-center gap-2">
      <button type="button" disabled={!ready || busy} aria-busy={busy} onClick={() => { setErr(null); setBusy(true); if (authenticated && identityToken) { sent.current = null; setBusy(false); } else login(); }}
        className="btn rounded-full bg-accent px-5 py-2 text-[13.5px] font-medium text-bg hover:brightness-110 active:bg-accent-press disabled:opacity-60" data-testid="privy-login">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {err && <span role="status" className="max-w-[22rem] text-center text-[12.5px] text-muted" data-testid="auth-calm">{err}</span>}
    </span>
  );
}
export default function PrivyLogin({ appId, onDone }: { appId: string; onDone?: () => void }) {
  return (
    <PrivyProvider appId={appId} config={{ defaultChain: ROBINHOOD_TESTNET as never, supportedChains: [ROBINHOOD_TESTNET as never], appearance: { theme: "dark" }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      <Inner onDone={onDone} />
    </PrivyProvider>
  );
}
