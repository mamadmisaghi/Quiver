// M5.21 (B6): listen first, then load price history in the background under a hard time cap.
// Until it settles, /v1/health reports "warming" and price-backed endpoints use whatever data is ready (with a notice).
export type WarmupState = "warming" | "ready" | "partial" | "timeout" | "off";
export class Warmup {
  state: WarmupState; startedAt: number | null = null; finishedAt: number | null = null; errors = 0; message: string | null = null;
  constructor(private now: () => number = Date.now, on = true) { this.state = on ? "warming" : "off"; }
  get warming() { return this.state === "warming"; }
  view() { return { state: this.state, startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null, finishedAt: this.finishedAt ? new Date(this.finishedAt).toISOString() : null, errors: this.errors, message: this.message }; }
  /** Runs `load` in the background; never throws, never blocks the caller. Settles at most `capMs` after start. */
  start(load: () => Promise<{ errors?: number } | void>, capMs: number): Promise<void> {
    this.startedAt = this.now(); this.state = "warming";
    let to: NodeJS.Timeout | undefined;
    const cap = new Promise<"timeout">((r) => { to = setTimeout(() => r("timeout"), capMs); to.unref?.(); });
    return Promise.race([load().then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e })), cap]).then((x) => {
      clearTimeout(to); this.finishedAt = this.now();
      if (x === "timeout") { this.state = "timeout"; this.message = `Price history did not finish loading within ${Math.round(capMs / 1000)}s; using the data loaded so far. It keeps refreshing in the background.`; return; }
      if (!x.ok) { this.state = "partial"; this.errors++; this.message = "Price history failed to load; using the data loaded so far."; return; }
      this.errors = x.r?.errors ?? 0; this.state = this.errors ? "partial" : "ready"; this.message = this.errors ? "Some price history could not be loaded." : null;
    });
  }
}
export const WARMUP_NOTICE = "The server is warming up after a restart: price history is still loading, so results use the data loaded so far.";
/** M5.22: machine-readable form (clients branch on `code`). */
export const WARMUP_OBJ = { code: "warming_up" as const, message: WARMUP_NOTICE };
/** Boot order helper (testable): call listen() synchronously, then start the warmup. */
export function listenThenWarm(listen: () => void, w: Warmup, load: () => Promise<{ errors?: number } | void>, capMs: number): Promise<void> { listen(); return w.start(load, capMs); }
