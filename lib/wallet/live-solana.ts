// Browser-only codec for user-confirmed, single-signer swaps. The server independently validates the route and token/account effects.
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function base58(bytes: Uint8Array): string {
  let n = 0n,
    zeroes = 0,
    out = "";
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  for (const b of bytes) {
    if (b !== 0) break;
    zeroes++;
  }
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeroes) + out;
}
function from58(s: string, length: number) {
  check(
    typeof s === "string" &&
      s.length > 0 &&
      s.length <= Math.ceil(length * 1.37) + 1,
    "Invalid wallet value.",
  );
  let n = 0n;
  for (const c of s) {
    const v = alphabet.indexOf(c);
    check(v >= 0, "Invalid base58 value.");
    n = n * 58n + BigInt(v);
  }
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  check(!n && base58(bytes) === s, "Unexpected wallet value length.");
  return bytes;
}
const to64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function from64(s: string) {
  check(
    typeof s === "string" &&
      s.length > 0 &&
      s.length <= 1644 &&
      s.length % 4 === 0,
    "Invalid transaction size.",
  );
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  check(
    bytes.length <= 1232 && to64(bytes) === s,
    "Invalid transaction encoding.",
  );
  return bytes;
}
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
function inspect(bytes: Uint8Array) {
  check(
    bytes.length >= 134 && bytes.length <= 1232 && bytes[0] === 1,
    "This route requires an unexpected number of signatures.",
  );
  const message = bytes.slice(65),
    sig = bytes.slice(1, 65);
  let p = 0;
  const take = (n: number) => {
    check(p + n <= message.length, "Truncated Solana message.");
    const start = p;
    p += n;
    return message.subarray(start, p);
  };
  const byte = () => take(1)[0];
  const len = () => {
    let out = 0;
    for (let i = 0; i < 3; i++) {
      const b = byte();
      check(i < 2 || b <= 3, "Invalid Solana vector length.");
      out += (b & 127) * 2 ** (7 * i);
      if ((b & 128) === 0) {
        check(i === 0 || b > 0, "Noncanonical Solana vector length.");
        return out;
      }
    }
    throw Error("Invalid Solana vector length.");
  };
  const first = byte(),
    v0 = first === 128;
  check(
    (v0 ? byte() : first) === 1 && byte() === 0,
    "The selected wallet must be the only signer and fee payer.",
  );
  const readOnly = byte(),
    keyCount = len();
  check(
    keyCount >= 1 && keyCount <= 256 && readOnly < keyCount,
    "Invalid Solana account header.",
  );
  const keys = take(keyCount * 32);
  const payer = base58(keys.slice(0, 32));
  const blockhash = take(32);
  check(
    blockhash.some((x) => x !== 0),
    "Missing transaction blockhash.",
  );
  const ix = len();
  check(ix > 0 && ix <= 255, "No executable swap instructions.");
  const indexes: number[] = [];
  for (let i = 0; i < ix; i++) {
    const program = byte();
    check(program > 0 && program < keyCount, "Invalid static program address.");
    const ac = take(len());
    for (const a of ac) indexes.push(a);
    take(len());
  }
  let total = keyCount;
  if (v0) {
    const tables = len();
    for (let i = 0; i < tables; i++) {
      take(32);
      total += take(len()).length;
      total += take(len()).length;
    }
  }
  check(
    p === message.length && total <= 256 && indexes.every((i) => i < total),
    "Invalid Solana transaction layout.",
  );
  return { message, sig, payer, version: v0 ? 0 : "legacy" };
}
function nowOk(deadline: number) {
  check(
    Number.isSafeInteger(deadline) && deadline > Date.now(),
    "The reviewed quote expired. Request a fresh quote.",
  );
}
async function sha256(message: Uint8Array) {
  const bits = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(message)),
  );
  return Array.from(bits, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifySignature(
  address: string,
  message: Uint8Array,
  signature: Uint8Array,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    from58(address, 32),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  check(
    signature.length === 64 &&
      (await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        new Uint8Array(signature),
        new Uint8Array(message),
      )),
    "The wallet signature did not match the quoted account and message.",
  );
}
export type SwapChallenge = {
  network: "solana:mainnet";
  wallet: string;
  transaction: string;
  messageHash: string;
  expiresAt: number;
};
export type SolanaSigner = {
  address: string;
  connectedAddress: () => Promise<string> | string;
  sign: (tx: Uint8Array, chain: "solana:mainnet") => Promise<Uint8Array>;
  signText?: (text: Uint8Array) => Promise<Uint8Array>;
};
export async function signSolanaQuote(
  signer: SolanaSigner,
  quote: SwapChallenge,
) {
  check(quote.network === "solana:mainnet", "Unexpected swap network.");
  nowOk(quote.expiresAt);
  const raw = from64(quote.transaction),
    unsigned = inspect(raw);
  check(
    /^[0-9a-f]{64}$/.test(quote.messageHash) &&
      (await sha256(unsigned.message)) === quote.messageHash,
    "The transaction differs from the reviewed quote.",
  );
  check(
    unsigned.sig.every((b) => b === 0) &&
      unsigned.payer === quote.wallet &&
      signer.address === quote.wallet &&
      (await signer.connectedAddress()) === quote.wallet,
    "Select the quoted Solana wallet before signing.",
  );
  const signedBytes = await signer.sign(raw.slice(), quote.network);
  check(
    signedBytes instanceof Uint8Array,
    "Unsupported wallet signing response.",
  );
  const frozen = new Uint8Array(signedBytes),
    signed = inspect(frozen);
  check(
    unsigned.payer === signed.payer && same(unsigned.message, signed.message),
    "The wallet changed the quoted transaction. Request a fresh quote.",
  );
  await verifySignature(quote.wallet, signed.message, signed.sig);
  check(
    (await signer.connectedAddress()) === quote.wallet,
    "The selected account changed during approval.",
  );
  nowOk(quote.expiresAt);
  return { signed: to64(frozen), txid: base58(signed.sig) };
}
export async function signSolanaOwnership(
  signer: SolanaSigner,
  address: string,
  message: string,
  nonce: string,
  origin: string,
) {
  const parts = message.split("\n");
  const url = new URL(origin);
  const issued = Date.parse((parts[9] ?? "").slice(11)),
    expiry = Date.parse((parts[10] ?? "").slice(17));
  check(
    url.origin === origin &&
      origin === window.location.origin &&
      parts.length === 11 &&
      parts[0] ===
        url.host + " wants you to link this Solana account to Quiver:" &&
      parts[1] === address &&
      parts[2] === "" &&
      parts[3] ===
        "Prove ownership of this wallet. This signature links it to your Quiver account." &&
      parts[4] === "" &&
      parts[5] === "URI: " + origin &&
      parts[6] === "Version: 1" &&
      /^Account: [A-Za-z0-9_.:@-]{1,160}$/.test(parts[7]) &&
      parts[8] === "Nonce: " + nonce &&
      /^[\w-]{22,128}$/.test(nonce) &&
      Number.isFinite(issued) &&
      Number.isFinite(expiry) &&
      parts[9] === "Issued At: " + new Date(issued).toISOString() &&
      parts[10] === "Expiration Time: " + new Date(expiry).toISOString() &&
      issued <= Date.now() + 10000 &&
      expiry > Date.now() &&
      expiry > issued &&
      expiry - issued <= 300000,
    "Unexpected or expired wallet-link challenge.",
  );
  check(
    message.length <= 1500 &&
      signer.signText &&
      signer.address === address &&
      (await signer.connectedAddress()) === address,
    "Select the wallet being linked.",
  );
  const bytes = new TextEncoder().encode(message),
    sig = await signer.signText(bytes);
  await verifySignature(address, bytes, sig);
  check(
    (await signer.connectedAddress()) === address,
    "The selected account changed during linking.",
  );
  return base58(sig);
}

type PhantomInjected = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signMessage?: (
    message: Uint8Array,
    encoding: "utf8",
  ) => Promise<{ signature: Uint8Array }>;
  request: (request: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<unknown>;
};
/** Fallback for Phantom's documented explicit signTransaction request when the Privy connector is unavailable. */
export async function injectedPhantom(): Promise<SolanaSigner> {
  const p = (window as Window & { phantom?: { solana?: PhantomInjected } })
    .phantom?.solana;
  check(
    p?.isPhantom && typeof p.request === "function",
    "Connect Phantom in this browser or select a connected Privy wallet.",
  );
  const address = (await p.connect()).publicKey.toString();
  from58(address, 32);
  const connectedAddress = () => p.publicKey?.toString() ?? "";
  return {
    address,
    connectedAddress,
    signText: p.signMessage
      ? async (bytes) => (await p.signMessage!(bytes, "utf8")).signature
      : undefined,
    sign: async (bytes) => {
      const { message } = inspect(bytes);
      const reply = await p.request({
        method: "signTransaction",
        params: { message: base58(message) },
      });
      check(
        reply && typeof reply === "object",
        "Phantom did not return a signed transaction.",
      );
      const v = reply as {
        publicKey?: { toString(): string } | string;
        serialize?: () => Uint8Array;
        signature?: string | Uint8Array;
        signedTransaction?: Uint8Array;
      };
      if (v.publicKey)
        check(
          v.publicKey.toString() === address,
          "Phantom returned a different signer.",
        );
      if (typeof v.serialize === "function")
        return new Uint8Array(v.serialize());
      if (v.signedTransaction instanceof Uint8Array) return v.signedTransaction;
      const sig =
        typeof v.signature === "string" ? from58(v.signature, 64) : v.signature;
      check(
        sig instanceof Uint8Array && sig.length === 64,
        "Phantom did not return the signed bytes.",
      );
      const result = bytes.slice();
      result.set(sig, 1);
      return result;
    },
  };
}
