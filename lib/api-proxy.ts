/** Same-origin bridge to the fixed Render API. Keeps the refresh cookie on the website origin. */
export async function proxyApi(request: Request, path: string[], base: string | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  const fail = (status: number, message: string) => Response.json({ error: { code: "service_unavailable", message, requestId: "proxy" } }, { status, headers: { "cache-control": "no-store" } });
  if (!base) return fail(503, "The paper service is not connected yet.");
  let api: URL; try { api = new URL(base.endsWith("/") ? base : base + "/"); } catch { return fail(503, "The paper service configuration is incomplete."); }
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash) return fail(503, "The paper service needs a secure API address.");
  if (!path.length || path.some((p) => !/^[A-Za-z0-9_.:@-]+$/.test(p) || p === "." || p === "..")) return fail(400, "Invalid API path.");
  // Operator routes are server-only and are never part of the visitor proxy.
  if (path[0] === "ops") return fail(404, "Route not found.");
  const input = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== input.origin) return fail(403, "Use the website to make this request.");
  const url = new URL(path.map(encodeURIComponent).join("/"), api); url.search = input.search;
  const headers = new Headers();
  for (const name of ["accept", "authorization", "content-type", "idempotency-key", "last-event-id"]) { const v = request.headers.get(name); if (v) headers.set(name, v); }
  // Never forward other Site/ChatGPT cookies, visitor IP claims or internal operator credentials.
  const refresh = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith("quiver_rt="));
  if (refresh && path[0] === "auth") headers.set("cookie", refresh);
  headers.set("origin", input.origin);
  try {
    const streaming = path.includes("stream");
    const timeout = path[0] === "compile" || path.includes("instruct") ? 60_000 : 25_000;
    const signal = streaming ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
    const upstream = await fetcher(url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, signal, redirect: "manual", duplex: "half" } as RequestInit);
    if (upstream.status >= 300 && upstream.status < 400) return fail(502, "The paper service returned an unexpected redirect.");
    const responseHeaders = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
    for (const name of ["content-type", "retry-after", "x-request-id", "x-quiver-rpc"]) { const v = upstream.headers.get(name); if (v) responseHeaders.set(name, v); }
    if (path[0] === "auth") {
      const cookies = upstream.headers.getSetCookie?.() ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
      for (const cookie of cookies) if (cookie.startsWith("quiver_rt=")) responseHeaders.append("set-cookie", cookie);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return fail(503, "The paper service did not respond. Please try again shortly."); }
}
