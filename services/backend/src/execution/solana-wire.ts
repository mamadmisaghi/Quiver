import { createHash, createPublicKey, verify } from "node:crypto";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const packetSize = 1232;

function fail(reason: string): never {
  throw new Error(reason);
}

export function encode58(data: Uint8Array): string {
  let n = 0n,
    zeros = 0,
    text = "";
  for (const byte of data) n = (n << 8n) | BigInt(byte);
  while (zeros < data.length && data[zeros] === 0) zeros++;
  while (n) {
    text = alphabet[Number(n % 58n)] + text;
    n /= 58n;
  }
  return "1".repeat(zeros) + text;
}

export function read58(input: string, bytes: number): Buffer {
  if (typeof input !== "string" || !input.length || input.length > Math.ceil(bytes * 1.37) + 1)
    fail("Invalid base58 length");
  let n = 0n;
  for (const char of input) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) fail("Invalid base58 character");
    n = n * 58n + BigInt(digit);
  }
  const out = Buffer.alloc(bytes);
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }
  if (n || encode58(out) !== input) fail("Invalid or noncanonical base58 value");
  return out;
}

export function verifyEd25519(address: string, payload: Uint8Array, signature: Uint8Array): boolean {
  const pub = read58(address, 32);
  if (signature.byteLength !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ed25519SpkiPrefix, pub]), format: "der", type: "spki" });
  return verify(null, payload, key, signature);
}

export type LinkChallenge = {
  address: string;
  origin: string;
  ownerId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};
export function ownershipMessage(c: LinkChallenge): string {
  read58(c.address, 32);
  const u = new URL(c.origin);
  if (
    c.origin !== u.origin ||
    (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))
  )
    fail("Invalid challenge origin");
  if (!/^[A-Za-z0-9_.:@-]{1,160}$/.test(c.ownerId) || !/^[A-Za-z0-9_-]{22,128}$/.test(c.nonce))
    fail("Invalid challenge fields");
  if (
    !Number.isSafeInteger(c.issuedAt) ||
    !Number.isSafeInteger(c.expiresAt) ||
    c.issuedAt < 0 ||
    c.expiresAt <= c.issuedAt ||
    c.expiresAt - c.issuedAt > 300_000
  )
    fail("Invalid challenge lifetime");
  return [
    u.host + " wants you to link this Solana account to Quiver:",
    c.address,
    "",
    "Prove ownership of this wallet. This signature links it to your Quiver account.",
    "",
    "URI: " + c.origin,
    "Version: 1",
    "Account: " + c.ownerId,
    "Nonce: " + c.nonce,
    "Issued At: " + new Date(c.issuedAt).toISOString(),
    "Expiration Time: " + new Date(c.expiresAt).toISOString(),
  ].join("\n");
}

/** Load stored challenge by nonce; callers must atomically consume it and enforce globally unique, case-sensitive wallet linkage. */
export function verifyLink(
  stored: LinkChallenge,
  expected: Pick<LinkChallenge, "ownerId" | "origin" | "address" | "nonce">,
  signature58: string,
  now: number,
): boolean {
  if (
    !Number.isSafeInteger(now) ||
    now < stored.issuedAt ||
    now >= stored.expiresAt ||
    stored.ownerId !== expected.ownerId ||
    stored.nonce !== expected.nonce ||
    stored.origin !== expected.origin ||
    stored.address !== expected.address
  )
    return false;
  return verifyEd25519(
    stored.address,
    Buffer.from(ownershipMessage(stored), "utf8"),
    read58(signature58, 64),
  );
}

export type WireTx = {
  version: "legacy" | 0;
  signatures: Buffer[];
  signerKeys: string[];
  accountKeys: string[];
  totalKeys: number;
  blockhash: string;
  message: Buffer;
  digest: string;
  programs: string[];
};

class Reader {
  offset = 0;
  constructor(readonly bytes: Buffer) {}
  take(count: number): Buffer {
    const start = this.offset;
    if (!Number.isInteger(count) || count < 0 || count > this.bytes.length - start)
      fail("Truncated Solana transaction");
    this.offset += count;
    return this.bytes.subarray(start, this.offset);
  }
  byte(): number {
    return this.take(1)[0];
  }
  short(): number {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const v = this.byte();
      if (i === 2 && v > 3) fail("ShortU16 overflow");
      n |= (v & 127) << (7 * i);
      if (!(v & 128)) {
        if (i && !v) fail("Noncanonical ShortU16");
        return n;
      }
    }
    return fail("Invalid ShortU16");
  }
}

/** Strict, bounded structural decoder. Does not claim that an arbitrary router program is safe to authorize. */
export function decodeWire(text: string): WireTx {
  if (
    typeof text !== "string" ||
    !text ||
    text.length > Math.ceil(packetSize / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(text)
  )
    fail("Invalid base64 transaction");
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > packetSize || bytes.toString("base64") !== text) fail("Invalid base64 transaction");
  const r = new Reader(bytes),
    count = r.short();
  if (!count || count > 18) fail("Invalid signature count");
  const signatures = Array.from({ length: count }, () => Buffer.from(r.take(64)));
  const start = r.offset,
    prefix = r.byte(),
    version = prefix & 128 ? prefix & 127 : "legacy";
  if (version !== "legacy" && version !== 0) fail("Unsupported Solana message version");
  const required = version === "legacy" ? prefix : r.byte();
  const roSigned = r.byte(),
    roUnsigned = r.byte(),
    staticCount = r.short();
  if (
    required !== count ||
    !staticCount ||
    staticCount > 256 ||
    required > staticCount ||
    roSigned >= count ||
    roUnsigned > staticCount - count
  )
    fail("Invalid account header");
  const accountKeys = Array.from({ length: staticCount }, () => encode58(r.take(32)));
  if (new Set(accountKeys).size !== staticCount) fail("Repeated static account");
  const blockhash = encode58(r.take(32)),
    ixCount = r.short();
  if (!ixCount || ixCount > bytes.length - r.offset) fail("Invalid instruction count");
  const programs: string[] = [];
  let maxIndex = 0,
    totalKeys = staticCount;
  for (let i = 0; i < ixCount; i++) {
    const program = r.byte();
    if (!program || program >= staticCount) fail("Invalid invoked program index");
    programs.push(accountKeys[program]);
    for (const idx of r.take(r.short())) maxIndex = Math.max(maxIndex, idx);
    r.take(r.short());
  }
  if (version === 0) {
    const tables = r.short();
    if (tables > 256) fail("Invalid lookup count");
    for (let i = 0; i < tables; i++) {
      r.take(32);
      const writable = r.take(r.short()),
        readonly = r.take(r.short());
      if (new Set([...writable, ...readonly]).size !== writable.length + readonly.length)
        fail("Repeated lookup index");
      totalKeys += writable.length + readonly.length;
    }
  }
  if (r.offset !== bytes.length || totalKeys > 256 || maxIndex >= totalKeys)
    fail("Invalid transaction account reference or trailing data");
  const message = Buffer.from(bytes.subarray(start));
  return {
    version,
    signatures,
    signerKeys: accountKeys.slice(0, count),
    accountKeys,
    totalKeys,
    blockhash,
    message,
    digest: createHash("sha256").update(message).digest("hex"),
    programs,
  };
}
