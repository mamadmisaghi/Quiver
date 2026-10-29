"use client";
// M5.2: GET /v1/auth/config drives the sign-in UI. Privy shows only when the server says privy.enabled and an app id is known
// (server appId, else NEXT_PUBLIC_PRIVY_APP_ID as a placeholder). Otherwise the dev login is the fallback.
import { useEffect, useState } from "react";
import { api, type AuthConfig } from "@/lib/api";
const ENV_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || null;
export type SignInMode = { cfg: AuthConfig | null; privyAppId: string | null; loading: boolean };
export function useAuthConfig(): SignInMode {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let on = true; api.authConfig().then((c) => on && setCfg(c)).catch(() => {}).finally(() => on && setLoading(false)); return () => { on = false; }; }, []);
  const privyAppId = cfg?.privy.enabled ? cfg.privy.appId ?? ENV_APP_ID : null;
  return { cfg, privyAppId, loading };
}
