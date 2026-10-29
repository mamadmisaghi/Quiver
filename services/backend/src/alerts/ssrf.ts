// M4.0 SSRF guard for user webhook URLs: https only, no credentials, every resolved address must be public unicast,
// and the connection is pinned to the address that was checked (no DNS-rebinding window).
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (h) => dnsLookup(h, { all: true, verbatim: true });

// M4.2.1: allowlist approach. IPv4 is allowed only outside every IANA special-purpose block; IPv6 is allowed only inside
// global unicast 2000::/3 minus Teredo/IETF-protocol (2001::/23), documentation (2001:db8::/32, 3fff::/20) and 6to4 (2002::/16).
// So mapped (::ffff:0:0/96, ::ffff:0:a.b.c.d), compat (::a.b.c.d), NAT64 (64:ff9b::/96), site-local fec0::/10, discard 100::/64, ULA, link-local, multicast are all refused.
function v4Num(ip: string): number { return ip.split(".").reduce((n, x) => n * 256 + Number(x), 0); }
const V4_BLOCK: [string, number][] = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]];
function v4Private(ip: string): boolean {
  const n = v4Num(ip);
  return V4_BLOCK.some(([base, len]) => Math.floor(n / 2 ** (32 - len)) === Math.floor(v4Num(base) / 2 ** (32 - len)));
}
/** Expands any valid IPv6 text form (incl. embedded dotted quad) to 8 hextets, or null. */
export function v6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { if (isIP(m[2]) !== 4) return null; const n = v4Num(m[2]); s = m[1] + (n >>> 16).toString(16) + ":" + (n & 0xffff).toString(16); }
  const parts = s.split("::"); if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [], tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - head.length - tail.length; if (parts.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array(parts.length === 2 ? fill : 0).fill("0"), ...tail];
  if (all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}
function v6Global(h: number[]): boolean {
  if ((h[0] & 0xe000) !== 0x2000) return false; // only 2000::/3
  if (h[0] === 0x2001 && h[1] < 0x200) return false; // 2001::/23 IETF protocol assignments incl. Teredo 2001::/32
  if (h[0] === 0x2001 && h[1] === 0xdb8) return false; // documentation
  if (h[0] === 0x2002) return false; // 6to4
  if ((h[0] & 0xfff0) === 0x3ff0) return false; // 3fff::/20 documentation
  return true;
}
/** True unless the address is public global unicast (allowlist). Anything unparsable is blocked. */
export function isBlockedIp(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, "");
  const v = isIP(s);
  if (v === 4) return v4Private(s);
  if (v !== 6) return true;
  const h = v6Hextets(s); return !h || !v6Global(h);
}

export class UrlBlocked extends Error {}
/** Static checks (no DNS). */
export function checkUrlShape(raw: string, extraPorts: string[] = []): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new UrlBlocked("Not a valid URL."); }
  if (u.protocol !== "https:") throw new UrlBlocked("Webhook URL must use https.");
  if (u.username || u.password) throw new UrlBlocked("Webhook URL must not contain credentials.");
  if (u.port && !["443", "8443", ...extraPorts].includes(u.port)) throw new UrlBlocked("Webhook port must be 443 or 8443.");
  const h = normHost(u.hostname);
  if (!h) throw new UrlBlocked("Webhook host is not public.");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) throw new UrlBlocked("Webhook host is not public.");
  if (isIP(h) && isBlockedIp(h)) throw new UrlBlocked("Webhook address is private or reserved.");
  return u;
}
/** Lower-cased, brackets and trailing dot(s) removed (M4.2.1: `LOCALHOST.` must hit the name check). */
export const normHost = (hn: string) => hn.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
/** Resolve and return the first public address; throws if ANY resolved address is blocked. */
export class DnsTimeout extends UrlBlocked {}
export async function resolvePublic(u: URL, resolve: Resolver, allowAddrs: string[] = [], timeoutMs = 3_000): Promise<{ address: string; family: number }> {
  const h = normHost(u.hostname);
  const addrs = isIP(h) ? [{ address: h, family: isIP(h) }] : await new Promise<{ address: string; family: number }[]>((res, rej) => {
    const t = setTimeout(() => rej(new DnsTimeout("Webhook host lookup timed out.")), timeoutMs); t.unref?.();
    resolve(h).then((a) => { clearTimeout(t); res(a); }, () => { clearTimeout(t); rej(new UrlBlocked("Webhook host does not resolve.")); });
  });
  if (!addrs.length) throw new UrlBlocked("Webhook host does not resolve.");
  for (const a of addrs) if (isBlockedIp(a.address) && !allowAddrs.includes(a.address)) throw new UrlBlocked("Webhook host resolves to a private or reserved address.");
  return addrs[0];
}
