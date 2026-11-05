"use client";
import { API_MODE } from "@/lib/api";
import { onSession } from "@/lib/api/session";
import { loadHostedSessions } from "./hosted";
import { useEffect, useState } from "react";
import { listPaperSessions, PAPER_SESSION_EVENT } from "./sessions";
import { paperAccount, type PaperAccount } from "./account";

export const decimal = (value: number | null) => value === null ? null : String(value);

export function usePaperAccount(enabled: boolean) {
  const [account, setAccount] = useState<PaperAccount | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true, ticket = 0;
    const refresh = async () => {
      const current = ++ticket;
      try {
        const sessions = API_MODE === "mock" ? listPaperSessions() : await loadHostedSessions();
        if (live && current === ticket) setAccount(paperAccount(sessions, Date.now()));
      } catch { if (live && current === ticket) setAccount(null); }
    };
    void refresh();
    const unsubscribe = onSession(() => { setAccount(null); void refresh(); });
    const interval = window.setInterval(() => void refresh(), API_MODE === "mock" ? 60_000 : 15_000);
    const events = [PAPER_SESSION_EVENT, "storage", "focus"];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      live = false; unsubscribe();
      window.clearInterval(interval);
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [enabled]);
  return account;
}
