import { encode } from "@msgpack/msgpack";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  assertEvmAccount,
  getReviewedEvmProvider,
  signHyperliquidOwner,
  type EvmSigner,
  type GrantChallenge,
} from "./live-evm";

type Hex = `0x${string}`;
type Action = Record<string, unknown>;
export type HlOwnerTerms = {
  kind: "hyperliquid-perp-v1";
  network: "hyperliquid-mainnet";
  wallet: string;
  instrument: string;
  market: {
    symbol: string;
    asset: number;
    szDecimals: number;
    maxLeverage: number;
  };
  leg: "entry" | "exit";
  side: "B" | "A";
  leverage: number;
  quantity: string;
  limit: string;
  cloid: string;
  marginUsd6: string;
  feeCapUsd6: string;
  ownerSignatures: {
    op: "leverage" | "order";
    action: Action;
    nonce: number;
    expiresAfter: number;
    typedData: unknown;
  }[];
};
const zero = "0x" + "0".repeat(40);
const hex = (b: Uint8Array) =>
  "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function object(v: unknown): Record<string, unknown> {
  check(
    typeof v === "object" && v !== null && !Array.isArray(v),
    "Malformed Hyperliquid payload.",
  );
  return v as Record<string, unknown>;
}
function sorted(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, w]) => [k, sorted(w)]),
        )
      : v;
}
const eq = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function nonce64(n: number) {
  check(Number.isSafeInteger(n) && n >= 0, "Invalid exchange nonce.");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(n), false);
  return bytes;
}
function digest(action: Action, nonce: number, expires: number) {
  const packed = encode(action),
    bytes = new Uint8Array(packed.length + 18);
  bytes.set(packed);
  bytes.set(nonce64(nonce), packed.length);
  // A zero vault-address marker and a second zero expiry marker precede the expiry in the SDK.
  bytes.set(nonce64(expires), packed.length + 10);
  return hex(keccak_256(bytes));
}
const domainFields = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;
const agentFields = [
  { name: "source", type: "string" },
  { name: "connectionId", type: "bytes32" },
] as const;
export function inspectHlOwnerOrder(
  t: HlOwnerTerms,
  expectedMaster: string,
  at = Date.now(),
) {
  const master = expectedMaster.toLowerCase();
  check(
    t.kind === "hyperliquid-perp-v1" &&
      t.network === "hyperliquid-mainnet" &&
      /^0x[0-9a-f]{40}$/.test(master) &&
      t.wallet.toLowerCase() === master,
    "Wrong Hyperliquid owner or network.",
  );
  check(
    (t.leg === "entry" || t.leg === "exit") &&
      (t.side === "A" || t.side === "B") &&
      Number.isSafeInteger(t.market.asset) &&
      t.market.asset >= 0 &&
      Number.isSafeInteger(t.market.szDecimals) &&
      t.market.szDecimals >= 0 &&
      t.market.szDecimals <= 6 &&
      Number.isSafeInteger(t.leverage) &&
      t.leverage >= 1 &&
      t.leverage <= t.market.maxLeverage,
    "Invalid perpetual order terms.",
  );
  const pos = (v: string) =>
    typeof v === "string" &&
    v.length <= 32 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/.test(v) &&
    v !== "0";
  check(
    pos(t.quantity) &&
      pos(t.limit) &&
      (t.quantity.split(".")[1]?.length ?? 0) <= t.market.szDecimals &&
      /^0x[0-9a-f]{32}$/.test(t.cloid),
    "Invalid quantity, limit or order ID.",
  );
  check(
    /^(0|[1-9]\d{0,23})$/.test(t.marginUsd6) &&
      /^(0|[1-9]\d{0,23})$/.test(t.feeCapUsd6),
    "Invalid margin or fee limits.",
  );
  check(
    t.instrument === "hl:perp:" + t.market.symbol &&
      /^(?:[a-z0-9]{1,16}:)?[A-Za-z0-9@._-]{1,24}$/.test(t.market.symbol),
    "Unexpected perpetual market identity.",
  );
  const atoms18 = (v: string) => {
    const [n, f = ""] = v.split(".");
    check(f.length <= 18, "Unsupported order precision.");
    return BigInt(n) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
  };
  const margin = BigInt(t.marginUsd6);
  check(
    t.leg === "exit"
      ? margin === 0n
      : margin > 0n &&
          atoms18(t.quantity) * atoms18(t.limit) <=
            margin * BigInt(t.leverage) * 10n ** 30n,
    "Order size exceeds the displayed margin at the quoted limit.",
  );
  const legs = t.leg === "entry" ? ["leverage", "order"] : ["order"];
  check(
    t.ownerSignatures?.length === legs.length,
    "Unexpected wallet signature count.",
  );
  const canonical: Action[] = [];
  if (t.leg === "entry")
    canonical.push({
      type: "updateLeverage",
      asset: t.market.asset,
      isCross: false,
      leverage: t.leverage,
    });
  canonical.push({
    type: "order",
    orders: [
      {
        a: t.market.asset,
        b: t.side === "B",
        p: t.limit,
        s: t.quantity,
        r: t.leg === "exit",
        t: { limit: { tif: "Ioc" } },
        c: t.cloid,
      },
    ],
    grouping: "na",
  });
  const data = t.ownerSignatures.map((p, i) => {
    check(
      p.op === legs[i] && eq(p.action, canonical[i]),
      "The wallet payload differs from the displayed order.",
    );
    check(
      Number.isSafeInteger(p.nonce) &&
        Number.isSafeInteger(p.expiresAfter) &&
        p.nonce <= at + 10000 &&
        at - p.nonce <= 60000 &&
        p.expiresAfter > at &&
        p.expiresAfter > p.nonce &&
        p.expiresAfter - p.nonce <= 60000 &&
        (!i || p.nonce > t.ownerSignatures[i - 1].nonce),
      "The exchange authorization expired.",
    );
    const td = object(p.typedData),
      types = object(td.types);
    const domain = {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: zero,
    };
    const message = {
      source: "a",
      connectionId: digest(canonical[i], p.nonce, p.expiresAfter),
    };
    check(
      eq(Object.keys(td).sort(), [
        "domain",
        "message",
        "primaryType",
        "types",
      ]) &&
        td.primaryType === "Agent" &&
        eq(td.domain, domain) &&
        eq(td.message, message) &&
        eq(types, {
          Agent: agentFields,
          ...("EIP712Domain" in types ? { EIP712Domain: domainFields } : {}),
        }),
      "The exchange digest does not match the reviewed order.",
    );
    return {
      domain,
      types: { EIP712Domain: domainFields, Agent: agentFields },
      primaryType: "Agent",
      message,
    };
  });
  return {
    master,
    data,
    expires: Math.min(...t.ownerSignatures.map((s) => s.expiresAfter)),
  };
}
/** Exchange uses the virtual EIP-712 domain 1337. Never switch a user to a private or made-up RPC to satisfy this domain. */
export async function signHlOwnerOrder(
  signer: EvmSigner,
  terms: HlOwnerTerms,
  expectedMaster: string,
) {
  const r = inspectHlOwnerOrder(terms, expectedMaster),
    p = await getReviewedEvmProvider(signer, r.master, 42161);
  const signatures: Hex[] = [];
  for (const d of r.data) {
    await assertEvmAccount(p, r.master, 42161);
    check(Date.now() < r.expires, "The reviewed order expired.");
    const sig = await p.request({
      method: "eth_signTypedData_v4",
      params: [r.master, JSON.stringify(d)],
    });
    check(
      typeof sig === "string" && /^0x[0-9a-f]{128}(?:1b|1c|00|01)$/i.test(sig),
      "Unexpected owner signature.",
    );
    signatures.push(sig as Hex);
  }
  await assertEvmAccount(p, r.master, 42161);
  check(Date.now() < r.expires, "The reviewed order expired.");
  return { kind: "wallet" as const, value: { signatures } };
}
export type PreviousGrant = { agent: string; name: string; nonce: number };
/** Verify a name-preserving deauthorization goes to the deterministic no-key address, not an attacker-controlled replacement. */
export async function signHlRevoke(
  signer: EvmSigner,
  c: GrantChallenge,
  old: PreviousGrant,
) {
  const msg = object(object(c.typedData).message),
    nonce = msg.nonce;
  check(
    typeof nonce === "string" &&
      /^[1-9]\d{9,15}$/.test(nonce) &&
      Number.isSafeInteger(old.nonce) &&
      Number(nonce) > old.nonce &&
      /^0x[0-9a-f]{40}$/i.test(old.agent) &&
      /^[A-Za-z0-9_-]{1,16}$/.test(old.name),
    "Invalid original grant.",
  );
  const commitment = [
    "Quiver agent deregistration v1",
    c.network,
    c.master.toLowerCase(),
    old.name,
    old.agent.toLowerCase(),
    String(old.nonce),
    nonce,
  ].join("|");
  const sink =
    "0x" + hex(keccak_256(new TextEncoder().encode(commitment))).slice(-40);
  check(
    c.agent.toLowerCase() === sink,
    "Unexpected replacement agent. Request a fresh revocation challenge.",
  );
  return signHyperliquidOwner(signer, {
    ...c,
    purpose: "revoke",
    slotName: old.name,
    validUntil: Number(nonce) + 60000,
  });
}
