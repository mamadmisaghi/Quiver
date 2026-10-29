import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
/** Minimal HS256 JWT (sign/verify) — no external dependency, constant-time compare. */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number, now = Date.now()) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(now / 1000) + ttlSec;
  const p = b64u(JSON.stringify({ ...payload, iat: Math.floor(now / 1000), exp }));
  const sig = b64u(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return { token: `${h}.${p}.${sig}`, exp: exp * 1000 };
}
export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string, now = Date.now()): T | null {
  const parts = token.split("."); if (parts.length !== 3) return null;
  const want = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], "base64url").toString()); if (typeof p.exp !== "number" || p.exp * 1000 <= now) return null; return p as T; } catch { return null; }
}
export const randomToken = (n = 32) => randomBytes(n).toString("base64url");
