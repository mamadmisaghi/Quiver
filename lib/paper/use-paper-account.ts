"use client";
import { useEffect, useState } from "react";
import { listPaperSessions, PAPER_SESSION_EVENT } from "./sessions";
import { paperAccount, type PaperAccount } from "./account";

export const decimal = (value: number | null) => value === null ? null : String(value);

export function usePaperAccount(enabled: boolean) {
  const [account, setAccount] = useState<PaperAccount | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setAccount(paperAccount(listPaperSessions(), Date.now()));
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    const events = [PAPER_SESSION_EVENT, "storage", "focus"];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      window.clearInterval(interval);
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, [enabled]);
  return account;
}
