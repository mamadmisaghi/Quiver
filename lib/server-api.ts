import { resolveMedia } from "./api/media";
// Server-side API base. Browser code may use a relative NEXT_PUBLIC_API_BASE ("/v1", proxied by the VPS front),
// but Node's fetch needs an absolute URL. Order: QUIVER_API_INTERNAL → absolute NEXT_PUBLIC_API_BASE → local default.
export const SERVER_API_DEFAULT = "http://127.0.0.1:8987/v1";
export function serverApiBase(): string {
  const internal = process.env.QUIVER_API_INTERNAL?.trim();
  if (internal && /^https?:\/\//.test(internal)) return internal.replace(/\/$/, "");
  const pub = process.env.NEXT_PUBLIC_API_BASE?.trim();
  if (pub && /^https?:\/\//.test(pub)) return pub.replace(/\/$/, "");
  return SERVER_API_DEFAULT;
}
// M5.21: server-side calls to a loopback API carry X-Quiver-Internal-Token (backend gives them a separate, larger limiter bucket).
// Server-only: INTERNAL_PROXY_TOKEN is a plain (non-NEXT_PUBLIC) env var, read at request time and never passed to client code.
// Unset → no header. Only the token is added: the visitor's X-Forwarded-For/headers are never forwarded.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
export function serverHeaders(url: string): Record<string, string> {
  const tok = process.env.INTERNAL_PROXY_TOKEN?.trim();
  if (!tok) return {};
  try { return LOOPBACK.has(new URL(url).hostname) ? { "x-quiver-internal-token": tok } : {}; } catch { return {}; }
}
/** fetch(serverApiBase() + path) with the internal header when it applies. */
export function serverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = serverApiBase() + path;
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...serverHeaders(url) } });
}
/** Absolute site origin for metadataBase / OG URLs (PUBLIC_BASE_URL, e.g. http://91.107.243.172:8091). */
export function publicBaseUrl(): URL | undefined {
  const v = process.env.PUBLIC_BASE_URL?.trim();
  try { return v ? new URL(v) : undefined; } catch { return undefined; }
}
/** M5.15 server side (metadata): a media URL the *browser* can reach, so absolute public API base first, then the site origin. */
export function serverMediaUrl(u: string | null | undefined): string | null {

  const pub = process.env.NEXT_PUBLIC_API_BASE?.trim();
  const base = pub && /^https?:\/\//.test(pub) ? pub : publicBaseUrl()?.origin ? publicBaseUrl()!.origin + "/v1" : serverApiBase();
  return resolveMedia(u, base);
}
