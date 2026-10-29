/**
 * M5.13: EIP-1193 JSON-RPC transport pinned to a pre-vetted IP (from userRpcFor). The TLS SNI / Host header keep the
 * original hostname, but the socket connects only to the vetted address, so DNS can't be rebound between check and use.
 * Bounded: timeout, response size cap, no redirects, https only (except tests can pass `insecureHttp`).
 */
import * as https from "node:https";
import * as http from "node:http";
import type { Eip1193 } from "./reader";

export interface Pinned { url: string; address: string; family: number }
export type RpcPost = (p: Pinned, body: string, timeoutMs: number) => Promise<string>;
export const RPC_MAX_BYTES = 1_000_000;

export const nodeRpcPost = (opts: { insecureHttp?: boolean } = {}): RpcPost => (p, body, timeoutMs) => new Promise((res, rej) => {
  const u = new URL(p.url); const isHttps = u.protocol === "https:";
  if (!isHttps && !opts.insecureHttp) return rej(new Error("RPC must use https"));
  const lib = isHttps ? https : http;
  const req = lib.request({ method: "POST", hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + u.search, servername: isHttps ? u.hostname : undefined,
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": "Quiver-RPC/1" }, timeout: timeoutMs,
    lookup: ((_h: string, o: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => o?.all ? cb(null, [{ address: p.address, family: p.family }]) : cb(null, p.address, p.family)) as never,
  }, (r) => {
    if ((r.statusCode ?? 0) >= 300) { r.resume(); return rej(new Error(`rpc http ${r.statusCode}`)); } // no redirects followed
    let n = 0; const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => { n += c.length; if (n > RPC_MAX_BYTES) { req.destroy(new Error("rpc response too large")); return; } chunks.push(c); });
    r.on("end", () => res(Buffer.concat(chunks).toString("utf8"))); r.on("error", rej);
  });
  const hard = setTimeout(() => req.destroy(new Error(`rpc timeout after ${timeoutMs}ms`)), timeoutMs);
  req.on("timeout", () => req.destroy(new Error(`rpc timeout after ${timeoutMs}ms`)));
  req.on("error", (e) => { clearTimeout(hard); rej(e); }); req.on("close", () => clearTimeout(hard));
  req.end(body);
});

let rid = 0;
/** EIP-1193 over a pinned POST. Pass into ChainReader({ transport }) — the reader's read-only guard still applies. */
export const pinnedTransport = (p: Pinned, post: RpcPost, timeoutMs = 4000): Eip1193 => ({
  request: async ({ method, params }) => {
    const raw = await post(p, JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params: params ?? [] }), timeoutMs);
    let j: { result?: unknown; error?: { message?: string } }; try { j = JSON.parse(raw); } catch { throw new Error("rpc returned non-JSON"); }
    if (j.error) throw new Error(`rpc error: ${String(j.error.message ?? "unknown").slice(0, 160)}`);
    return j.result;
  },
});
