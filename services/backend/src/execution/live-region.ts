import { createHash, createPublicKey, verify } from "node:crypto";

const lifetimeMs = 30_000;
const futureSkewMs = 5_000;
/** Multiple layers may verify the same Request. Another Request cannot reuse its proof. */
const seen = new Map<string, { request: WeakRef<Request>; until: number }>();
let nextPrune = 0;

export function verifiedEdgeCountry(
  request: Request,
  siteOrigin: string | undefined,
  publicDer: string | undefined,
  now: number,
): string | null {
  if (
    !siteOrigin ||
    !publicDer ||
    !Number.isSafeInteger(now) ||
    request.headers.get("origin") !== siteOrigin
  )
    return null;
  const proof = request.headers.get("x-quiver-origin-proof");
  if (!proof || proof.length > 180) return null;
  const match =
    /^(\d{13})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Z]{2})\.([A-Za-z0-9+/]{86}==)$/.exec(
      proof,
    );
  if (!match) return null;
  const [, at, nonce, country, signature] = match,
    issueTime = Number(at);
  if (
    country === "XX" ||
    now - issueTime > lifetimeMs ||
    issueTime - now > futureSkewMs
  )
    return null;
  // Accept only the Ed25519 SPKI envelope, even if a differently configured provider accepts another algorithm.
  if (!/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/.test(publicDer)) return null;
  const url = new URL(request.url);
  const auth = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest("base64");
  const message = [
    "quiver-origin-v1",
    siteOrigin,
    request.method,
    url.pathname + url.search,
    at,
    nonce,
    country,
    auth,
  ].join("\n");
  try {
    const key = createPublicKey({
      key: Buffer.from(publicDer, "base64"),
      type: "spki",
      format: "der",
    });
    if (
      !verify(null, Buffer.from(message), key, Buffer.from(signature, "base64"))
    )
      return null;
  } catch {
    return null;
  }
  if (now >= nextPrune) {
    for (const [id, record] of seen) if (record.until < now) seen.delete(id);
    nextPrune = now + 5000;
  }
  const prior = seen.get(nonce);
  if (prior && prior.until >= now)
    return prior.request.deref() === request ? country : null;
  if (seen.size >= 12000) return null;
  seen.set(nonce, {
    request: new WeakRef(request),
    until: issueTime + lifetimeMs,
  });
  return country;
}
