import type { RunEvent } from "../../contracts/src/events";

export interface SseWriter { write(f: { id?: string; event: string; data: string; retry?: number }): Promise<void> }
export interface SseOpts { heartbeatMs: number; maxQueue: number; writeTimeoutMs?: number; now: () => number }

/**
 * One SSE subscriber of a run's append-only event log.
 *  - resume: replays log entries with seq > cursor (from Last-Event-ID / ?since), then live events; seq is the SSE id
 *  - ordering: a single drain loop (no concurrent writes); duplicates/older seqs are dropped
 *  - heartbeat: a `heartbeat` frame when nothing was written for heartbeatMs (keeps proxies from idling out)
 *  - backpressure: live events queue while a write is in flight; if the queue exceeds maxQueue, or one write takes
 *    longer than writeTimeoutMs, the subscriber sends `resync` {lastSeq} and closes. The client reconnects with
 *    Last-Event-ID and is replayed from the log, so nothing is lost and a slow client can't grow server memory.
 */
export class SseSubscriber {
  private queue: RunEvent[] = []; private draining = false; private closed = false; private lastWrite: number;
  private hb: NodeJS.Timeout | null = null;
  overflowed = false;
  constructor(private w: SseWriter, public cursor: number, private o: SseOpts, private onClose: () => void) { this.lastWrite = o.now(); }

  async start(snapshot: RunEvent[], log: RunEvent[], retryMs = 3000) {
    let first = true;
    for (const f of snapshot) { await this.write({ event: f.type, data: JSON.stringify(f), ...(first ? { retry: retryMs } : {}) }); first = false; }
    for (const e of log) if (e.seq > this.cursor) { await this.write({ id: String(e.seq), event: e.type, data: JSON.stringify(e) }); this.cursor = e.seq; }
    this.hb = setInterval(() => void this.heartbeat(), Math.max(250, Math.floor(this.o.heartbeatMs / 2))); this.hb.unref?.();
    void this.drain();
  }
  push(e: RunEvent) {
    if (this.closed || e.seq <= this.cursor) return;
    this.queue.push(e);
    if (this.queue.length > this.o.maxQueue) { void this.resync(); return; }
    void this.drain();
  }
  private async drain() {
    if (this.draining || this.closed) return; this.draining = true;
    try { while (this.queue.length && !this.closed) { const e = this.queue.shift()!; if (e.seq <= this.cursor) continue; await this.write({ id: String(e.seq), event: e.type, data: JSON.stringify(e) }); this.cursor = e.seq; } }
    catch { this.close(); } finally { this.draining = false; }
  }
  async heartbeat(lastSeq?: number) {
    if (this.closed || this.draining || this.o.now() - this.lastWrite < this.o.heartbeatMs) return;
    try { await this.write({ event: "heartbeat", data: JSON.stringify({ type: "heartbeat", ts: new Date(this.o.now()).toISOString(), lastSeq: lastSeq ?? this.cursor }) }); } catch { this.close(); }
  }
  private async resync() {
    if (this.closed) return; this.overflowed = true; this.queue = [];
    try { await Promise.race([this.w.write({ event: "resync", data: JSON.stringify({ type: "resync", reason: "slow_consumer", lastSeq: this.cursor, reconnectWithLastEventId: true }) }), new Promise((r) => setTimeout(r, 1000).unref?.())]); } catch { /* closing anyway */ }
    this.close();
  }
  private async write(f: { id?: string; event: string; data: string; retry?: number }) {
    const t = this.o.writeTimeoutMs ?? 30_000; let to: NodeJS.Timeout | undefined;
    await Promise.race([this.w.write(f), new Promise((_, rej) => { to = setTimeout(() => rej(new Error("sse write timeout")), t); to.unref?.(); })]).finally(() => clearTimeout(to));
    this.lastWrite = this.o.now();
  }
  close() { if (this.closed) return; this.closed = true; if (this.hb) clearInterval(this.hb); this.queue = []; this.onClose(); }
  get isClosed() { return this.closed; }
}
