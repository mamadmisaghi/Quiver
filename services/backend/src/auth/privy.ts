/**
 * M5.2: server-side Privy identity-token verification (ES256 JWT). No SDK, node:crypto only.
 * Fails closed: no app id/secret → PrivyUnavailable; any check failing → PrivyInvalid.
 * Checks: alg ES256, kid known (JWKS) or the configured PEM, signature, iss "privy.io", aud = app id, exp/nbf/iat (60 s skew), sub "did:privy:".
 */
import { createPublicKey, verify as cverify, type KeyObject } from "node:crypto";
type JsonWebKey = { kty?: string; crv?: string; x?: string; y?: string; [k: string]: unknown };

export class PrivyUnavailable extends Error {}
export class PrivyInvalid extends Error {}
export interface PrivyIdentity { sub: string; wallets: string[]; email: string | null }
export type JwksFetch = (url: string) => Promise<{ keys: (JsonWebKey & { kid?: string })[] }>;
export interface PrivyOpts { appId?: string; appSecret?: string; verificationKeyPem?: string; jwksUrl?: string; fetchJwks?: JwksFetch; now?: () => number; /** M5.24c: min ms between JWKS fetches (default 30 s). */ jwksMinIntervalMs?: number }

const b64 = (s: string) => Buffer.from(s, "base64url");
const SKEW = 60;

export class PrivyVerifier {
  private cache: { at: number; keys: Map<string, KeyObject> } | null = null;
  private pem: KeyObject | null;
  private inflight: Promise<void> | null = null; private lastFetchAt: number | null = null;
  /** Fetch counter (tests/ops). */ fetches = 0;
  private async refetch() {
    this.lastFetchAt = this.now(); this.fetches++;
    const url = this.o.jwksUrl ?? `https://auth.privy.io/api/v1/apps/${encodeURIComponent(this.o.appId!)}/jwks.json`;
    let j: Awaited<ReturnType<JwksFetch>>;
    try { j = await (this.o.fetchJwks ?? defaultFetch)(url); } catch { throw new PrivyUnavailable("Privy keys unreachable"); }
    const keys = new Map<string, KeyObject>();
    for (const k of j.keys ?? []) if (k.kty === "EC" && k.crv === "P-256") keys.set(k.kid ?? "", createPublicKey({ key: k as never, format: "jwk" }));
    this.cache = { at: this.now(), keys };
  }
  constructor(private o: PrivyOpts) { this.pem = o.verificationKeyPem ? createPublicKey(o.verificationKeyPem.replace(/\\n/g, "\n")) : null; }
  get appId(): string | null { return this.o.appId ?? null; }
  get configured(): boolean { return !!(this.o.appId && this.o.appSecret); }
  /** M5.25: default 30 s, floor 10 s even if configured lower. */
  get minInterval(): number { return Math.max(10_000, this.o.jwksMinIntervalMs ?? 30_000); }
  private now() { return (this.o.now ?? Date.now)(); }

  private async key(kid: string | undefined): Promise<KeyObject> {
    if (this.pem) return this.pem;
    const fresh = this.cache && this.now() - this.cache.at < 600_000;
    if (!fresh || (kid && !this.cache!.keys.has(kid))) {
      // M5.24c: cooldown + single-flight. Unknown kids can't force a fetch per request; concurrent misses share one fetch.
      const cooling = this.lastFetchAt !== null && this.now() - this.lastFetchAt < this.minInterval;
      // M5.25: an unknown kid gets exactly one refetch once the cooldown has elapsed; if still unknown → 401, no further fetch.
      if (this.inflight) await this.inflight;
      else if (!cooling) { this.inflight = this.refetch().finally(() => { this.inflight = null; }); await this.inflight; }
      else if (!this.cache) throw new PrivyUnavailable("Privy keys unreachable"); // last fetch failed recently: don't hammer
    }
    if (!this.cache) throw new PrivyUnavailable("Privy keys unreachable");
    const k = kid ? this.cache!.keys.get(kid) : this.cache!.keys.size === 1 ? [...this.cache!.keys.values()][0] : undefined;
    if (!k) throw new PrivyInvalid("unknown key id");
    return k;
  }

  async verify(token: string): Promise<PrivyIdentity> {
    if (!this.configured) throw new PrivyUnavailable("Privy is not configured");
    const parts = token.split("."); if (parts.length !== 3) throw new PrivyInvalid("malformed token");
    let h: { alg?: string; kid?: string; typ?: string }, p: Record<string, unknown>;
    try { h = JSON.parse(b64(parts[0]).toString()); p = JSON.parse(b64(parts[1]).toString()); } catch { throw new PrivyInvalid("malformed token"); }
    if (h.alg !== "ES256") throw new PrivyInvalid("alg must be ES256");
    const key = await this.key(h.kid);
    const ok = cverify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, b64(parts[2]));
    if (!ok) throw new PrivyInvalid("bad signature");
    const t = Math.floor(this.now() / 1000);
    if (p.iss !== "privy.io") throw new PrivyInvalid("bad issuer");
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud]; if (!aud.includes(this.o.appId)) throw new PrivyInvalid("bad audience");
    if (typeof p.exp !== "number" || p.exp + SKEW < t) throw new PrivyInvalid("expired");
    if (typeof p.nbf === "number" && p.nbf - SKEW > t) throw new PrivyInvalid("not yet valid");
    if (typeof p.iat === "number" && p.iat - SKEW > t) throw new PrivyInvalid("issued in the future");
    if (typeof p.sub !== "string" || !/^did:privy:[A-Za-z0-9_-]{6,64}$/.test(p.sub)) throw new PrivyInvalid("bad subject");
    // identity tokens carry linked_accounts as a JSON string
    let la: { type?: string; address?: string; chain_type?: string }[] = [];
    try { la = typeof p.linked_accounts === "string" ? JSON.parse(p.linked_accounts) : Array.isArray(p.linked_accounts) ? (p.linked_accounts as typeof la) : []; } catch { la = []; }
    const wallets = la.filter((a) => a.type === "wallet" && (a.chain_type ?? "ethereum") === "ethereum" && /^0x[0-9a-fA-F]{40}$/.test(a.address ?? "")).map((a) => a.address!);
    const email = (la.find((a) => a.type === "email") as { address?: string } | undefined)?.address ?? null;
    return { sub: p.sub, wallets, email };
  }
}

const defaultFetch: JwksFetch = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "error" });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  return (await r.json()) as Awaited<ReturnType<JwksFetch>>;
};
