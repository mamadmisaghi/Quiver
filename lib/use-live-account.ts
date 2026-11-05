"use client";
import { useEffect } from "react";
import { API_MODE } from "./api";
import { useQ } from "./api/useQ";
import { connected, type Account } from "./live-client";

export function useLiveAccount() {
  const production = API_MODE === "live";
  const account = useQ(
    () => (production ? connected<Account>("/account") : Promise.resolve(null)),
    [production],
  );
  const service = useQ(async () => {
    if (!production) return false;
    const response = await fetch("/v1/live/status", { cache: "no-store" });
    if (!response.ok) return false;
    const status = (await response.json()) as { enabled?: boolean };
    return status.enabled === true;
  }, [production]);
  const signedIn = !!account.data;
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(account.reload, 20000);
    return () => clearInterval(timer);
  }, [signedIn]);
  return { account, production, enabled: service.data === true };
}
