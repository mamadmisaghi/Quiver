import { AsyncLocalStorage } from "node:async_hooks";

type Location = { country: string; privateDer: string };
const location = new AsyncLocalStorage<Location | undefined>();
let imported: { encoded: string; key: Promise<CryptoKey> } | undefined;

export function withEdgeLocation<T>(
  country: unknown,
  privateDer: unknown,
  task: () => T,
): T {
  const known =
    typeof country === "string" &&
    /^[A-Z]{2}$/.test(country) &&
    country !== "XX" &&
    typeof privateDer === "string" &&
    privateDer.length > 0;
  return location.run(known ? { country, privateDer } : undefined, task);
}
const base64 = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

/** Only worker/index.ts calls withEdgeLocation, using request.cf.country from the edge runtime. */
export async function attestEdge(
  headers: Headers,
  url: URL,
  method: string,
  origin: string,
) {
  headers.delete("x-quiver-origin-proof");
  const loc = location.getStore();
  if (!loc) return;
  if (!imported || imported.encoded !== loc.privateDer) {
    const der = Uint8Array.from(atob(loc.privateDer), (c) => c.charCodeAt(0));
    imported = {
      encoded: loc.privateDer,
      key: crypto.subtle.importKey("pkcs8", der, "Ed25519", false, ["sign"]),
    };
  }
  const encoder = new TextEncoder(),
    at = String(Date.now()),
    nonce = crypto.randomUUID();
  const auth = base64(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(headers.get("authorization") ?? ""),
    ),
  );
  const message = [
    "quiver-origin-v1",
    origin,
    method,
    url.pathname + url.search,
    at,
    nonce,
    loc.country,
    auth,
  ].join("\n");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    await imported.key,
    encoder.encode(message),
  );
  headers.set(
    "x-quiver-origin-proof",
    [at, nonce, loc.country, base64(signature)].join("."),
  );
}
