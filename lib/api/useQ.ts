"use client";
// Client data hook: live mode needs a per-browser token, so every data screen loads through here.
import { useEffect, useState } from "react";
import { ApiErr } from "./types";
import { errCopy } from "./format";
import { onSession } from "./session";
export type Q<T> = { data: T | null; error: string | null; auth: boolean; status?: number | null; reload: () => void };
export function useQ<T>(load: () => Promise<T>, deps: unknown[] = []): Q<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState(false);
  const [n, setN] = useState(0);
  const [status, setStatus] = useState<number | null>(null);
  useEffect(() => onSession(() => setN((x) => x + 1)), []);
  useEffect(() => {
    let on = true;
    load().then((d) => { if (on) { setData(d); setError(null); setAuth(false); setStatus(null); } }).catch((e) => { if (!on) return; setStatus(e instanceof ApiErr ? e.status : null); const a = e instanceof ApiErr && (e.code === "unauthorized" || e.status === 401); setAuth(a); setError(a ? "Sign in to load your data." : e instanceof ApiErr ? errCopy(e.code, e.message) : "Couldn't reach Quiver."); });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, auth, status, reload: () => { setError(null); setAuth(false); setN((x) => x + 1); } };
}
