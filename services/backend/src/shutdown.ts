// M3.7: one graceful stop path for every way the process is asked to end.
//   POSIX:   SIGINT (Ctrl+C), SIGTERM (kill / systemd / docker stop), SIGHUP (terminal closed).
//   Windows: SIGINT (Ctrl+C), SIGBREAK (Ctrl+Break, and what Node raises for CTRL_CLOSE/LOGOFF/SHUTDOWN on some hosts),
//            SIGHUP (console window closed; Windows force-kills ~10 s later).
//   HTTP:    POST /v1/ops/shutdown with the OPS_TOKEN (the reliable path for a Task Scheduler job: `schtasks /end`
//            calls TerminateProcess, which no handler can catch).
// Order: stop runs (no more ticks) → flushSync dev persistence → close the server → exit(0). Idempotent; a watchdog
// forces exit(1) if anything hangs.
export type StopReason = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGBREAK" | "ops" | "beforeExit";
export interface ShutdownDeps {
  stopRuns: () => void;
  flush: () => unknown;
  closeServer: (done: () => void) => void;
  extra?: () => void;
  log?: (r: Record<string, unknown>) => void;
  exit?: (code: number) => void;
  /** max time to wait for server.close before exiting anyway */
  timeoutMs?: number;
}
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const;

export function makeGracefulStop(d: ShutdownDeps) {
  const log = d.log ?? ((r) => console.log(JSON.stringify(r)));
  const exit = d.exit ?? ((c) => process.exit(c));
  let started = false;
  return (reason: StopReason) => {
    if (started) return false; started = true;
    log({ level: "info", msg: "graceful shutdown", reason });
    const step = (name: string, f?: () => void) => { try { f?.(); } catch (e) { log({ level: "error", msg: `shutdown step failed: ${name}`, error: String(e) }); } };
    step("extra", d.extra); step("stopRuns", d.stopRuns);
    let exited = false; const finish = (code: number) => { if (exited) return; exited = true; log({ level: "info", msg: "shutdown complete", code }); exit(code); };
    const wd = setTimeout(() => finish(1), d.timeoutMs ?? 5000); wd.unref?.();
    const close = () => {
      // Start the connection-close deadline only AFTER durable storage has flushed.
      const soft = setTimeout(() => finish(0), Math.min(1500, d.timeoutMs ?? 5000)); soft.unref?.();
      try { d.closeServer(() => { clearTimeout(wd); clearTimeout(soft); finish(0); }); } catch { finish(0); }
    };
    try {
      const flushing = d.flush();
      if (flushing && typeof (flushing as Promise<unknown>).then === "function") void Promise.resolve(flushing).then(close, () => { log({ level: "error", msg: "Durable shutdown flush failed" }); finish(1); });
      else close();
    } catch { log({ level: "error", msg: "Shutdown flush failed" }); finish(1); }
    return true;
  };
}

export function installShutdownSignals(stop: (r: StopReason) => unknown, proc: Pick<NodeJS.Process, "on"> = process) {
  for (const s of SHUTDOWN_SIGNALS) { try { proc.on(s as NodeJS.Signals, () => stop(s)); } catch { /* signal not supported on this platform */ } }
}
