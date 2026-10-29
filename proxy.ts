// Gate fix (gate-web-4c5845b): unknown or revoked share links get a real HTTP 404.
// The /r and /c pages stream under Suspense (cacheComponents), so a notFound() there can only change the UI, not the status.
// This proxy asks the public API first and, on 404 (or a malformed token), rewrites to an unrouted path so Next serves
// app/not-found.tsx with status 404. Network/5xx errors fall through so the page can show its calm "try again" state.
import { NextResponse, type NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";
import { Handle } from "@/lib/contracts/social";
import { MOCK_PROFILE_HANDLES } from "@/lib/api/social-mock";

const KINDS = { r: { re: /^rpl_[A-Za-z0-9_-]{8,64}$/, path: "replays" }, c: { re: /^crd_[A-Za-z0-9_-]{8,64}$/, path: "cards" } } as const;
const LIVE = process.env.NEXT_PUBLIC_API_MODE === "live";

const gone = (req: NextRequest) => {
  const res = NextResponse.rewrite(new URL("/_share-gone", req.url));
  res.headers.set("x-robots-tag", "noindex");
  return res;
};
// Gate fix (gate-web-0e978a2): /u/<handle> gets a real 404 for a malformed handle, and in mock mode for any handle the mock
// doesn't know; in live mode for any handle GET /v1/public/profiles/:handle (backend 85377f4, no auth) answers 404 for.
// W1 (gate 4eaca8b): ~30 s in-memory cache of public profile lookups (matches the API's max-age=30), bounded in size.
const PROFILE_TTL_MS = 30_000, PROFILE_MAX = 5000;
const PROFILE_CACHE = new Map<string, { exists: boolean; exp: number }>();
function remember(h: string, exists: boolean) {
  if (PROFILE_CACHE.size >= PROFILE_MAX) { const now = Date.now(); for (const [k, v] of PROFILE_CACHE) if (v.exp <= now) PROFILE_CACHE.delete(k); }
  if (PROFILE_CACHE.size >= PROFILE_MAX) PROFILE_CACHE.delete(PROFILE_CACHE.keys().next().value!);
  PROFILE_CACHE.delete(h); PROFILE_CACHE.set(h, { exists, exp: Date.now() + PROFILE_TTL_MS });
}
async function profile(req: NextRequest, raw: string) {
  let h = raw;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(h); i++) { try { h = decodeURIComponent(h); } catch { return gone(req); } }
  if (!Handle.safeParse(h).success) return gone(req);
  if (!LIVE) return MOCK_PROFILE_HANDLES.includes(h) ? NextResponse.next() : gone(req);
  const hit = PROFILE_CACHE.get(h);
  if (hit && hit.exp > Date.now()) return hit.exists ? NextResponse.next() : gone(req);
  try { // M5.20: unauthenticated existence check. Only a 404 404s; 429/5xx/network fail open so the page renders.
    const r = await serverFetch(`/public/profiles/${encodeURIComponent(h)}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (r.status === 200 || r.status === 404) remember(h, r.status === 200); // W1: cache answers only, never errors or 429s
    if (r.status === 404) return gone(req);
  } catch { /* fail open */ }
  return NextResponse.next();
}

export async function proxy(req: NextRequest) {
  const u = /^\/u\/([^/]+)\/?$/.exec(req.nextUrl.pathname);
  if (u) return profile(req, u[1]);
  const m = /^\/(r|c)\/([^/]+)\/?$/.exec(req.nextUrl.pathname);
  if (!m) return NextResponse.next();
  const k = KINDS[m[1] as "r" | "c"];
  let token: string; try { token = decodeURIComponent(m[2]); } catch { token = ""; }
  let isGone = !k.re.test(token);
  if (!isGone && LIVE) {
    try {
      const r = await serverFetch(`/public/${k.path}/${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      isGone = r.status === 404;
    } catch { /* unreachable API → let the page render its retry state */ }
  }
  return isGone ? gone(req) : NextResponse.next();
}
export const config = { matcher: ["/r/:token", "/c/:token", "/u/:handle"] };
