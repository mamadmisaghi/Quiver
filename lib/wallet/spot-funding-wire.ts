import { base58, type SolanaSigner } from "@/lib/wallet/live-solana";
export type FundingScope = {
  fundingOwner: string;
  executor: string;
  inputMint: string;
  inputAccount: string;
  outputMint: string;
  outputAccount: string;
  totalInputUnits: string;
};
const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  SYSTEM = "11111111111111111111111111111111";
const SHARED_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
function ok(v: unknown, msg: string): asserts v {
  if (!v) throw Error(msg);
}
const to64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function read(s: string) {
  ok(s.length <= 1644 && s.length > 0, "Invalid transaction size.");
  const b = Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
  ok(b.length <= 1232 && to64(b) === s, "Invalid transaction encoding.");
  return b;
}
export function inspectSpotSetup(
  unsigned: string,
  kind: "approve" | "revoke",
  scopes: FundingScope[],
) {
  const b = read(unsigned),
    s = scopes[0];
  ok(
    s && b[0] === 1 && b.slice(1, 65).every((x) => !x),
    "Expected an unsigned single-signer transaction.",
  );
  let offset = 65;
  const take = (n: number) => {
      ok(
        Number.isSafeInteger(n) && n >= 0 && offset + n <= b.length,
        "Malformed transaction.",
      );
      const a = b.slice(offset, offset + n);
      offset += n;
      return a;
    },
    u8 = () => take(1)[0];
  const len = () => {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const a = u8();
      v |= (a & 127) << (7 * i);
      if (!(a & 128)) {
        ok(i === 0 || a > 0, "Noncanonical vector.");
        return v;
      }
    }
    throw Error("Oversized vector.");
  };
  ok(u8() === 1 && u8() === 0, "Only the funding wallet may sign.");
  const readonly = u8(),
    count = len();
  ok(count > 0 && count <= 32 && readonly < count, "Unexpected account list.");
  const keys = Array.from({ length: count }, () => ({
    bytes: take(32),
    address: "",
  }));
  for (const k of keys) k.address = base58(k.bytes);
  ok(
    keys[0].address === s.fundingOwner &&
      keys[0].address !== s.executor &&
      scopes.every(
        (x) =>
          x.fundingOwner === s.fundingOwner &&
          x.executor === s.executor &&
          x.inputMint === SHARED_USDC &&
          x.inputAccount === s.inputAccount &&
          x.totalInputUnits === s.totalInputUnits,
      ),
    "Wrong funding wallet, mint or terms.",
  );
  const by = (i: number) => {
      ok(i < keys.length, "Invalid account index.");
      return keys[i].address;
    },
    blockhash = take(32);
  ok(
    blockhash.some((x) => x !== 0),
    "Invalid recent blockhash.",
  );
  const n = len(),
    created = new Set<string>();
  ok(
    n >= 1 && n <= scopes.length + 1 && (kind === "approve" || n === 1),
    "Unexpected setup instructions.",
  );
  for (let i = 0; i < n; i++) {
    const program = by(u8()),
      accounts = Array.from(take(len()), by),
      data = take(len());
    const equal = (a: string[], b: string[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    if (i === n - 1) {
      if (kind === "revoke") {
        ok(
          program === SPL &&
            data.length === 1 &&
            data[0] === 5 &&
            equal(accounts, [s.inputAccount, s.fundingOwner]),
          "Unexpected revocation instruction.",
        );
      } else {
        ok(data.length === 10, "Invalid allowance instruction.");
        const amount = new DataView(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        ).getBigUint64(1, true);
        ok(
          program === SPL &&
            data[0] === 13 &&
            data[9] === 6 &&
            amount === BigInt(s.totalInputUnits) &&
            equal(accounts, [
              s.inputAccount,
              s.inputMint,
              s.executor,
              s.fundingOwner,
            ]),
          "Delegated amount or spender changed.",
        );
      }
    } else {
      const allowed = scopes.find(
        (v) => v.outputAccount === accounts[1] && v.outputMint === accounts[3],
      );
      ok(
        allowed &&
          program === ATA &&
          data.length === 1 &&
          data[0] === 1 &&
          !created.has(accounts[1]) &&
          equal(accounts, [
            s.fundingOwner,
            allowed.outputAccount,
            s.fundingOwner,
            allowed.outputMint,
            SYSTEM,
            SPL,
          ]),
        "Unexpected token account creation.",
      );
      created.add(accounts[1]);
    }
  }
  ok(offset === b.length, "Trailing transaction bytes.");
  return { b, ownerBytes: keys[0].bytes, created: [...created] };
}
export async function signSpotSetup(
  signer: SolanaSigner,
  kind: "approve" | "revoke",
  unsigned: string,
  scopes: FundingScope[],
) {
  const { b, ownerBytes } = inspectSpotSetup(unsigned, kind, scopes),
    owner = scopes[0].fundingOwner;
  ok(
    signer.address === owner && (await signer.connectedAddress()) === owner,
    "Select the funding wallet.",
  );
  const signed = await signer.sign(b.slice(), "solana:mainnet");
  ok(
    (await signer.connectedAddress()) === owner &&
      signed.length === b.length &&
      signed[0] === 1 &&
      b.slice(65).every((x, i) => signed[i + 65] === x),
    "Wallet changed the approved transaction.",
  );
  const k = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(ownerBytes),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  ok(
    await crypto.subtle.verify(
      { name: "Ed25519" },
      k,
      Uint8Array.from(signed.slice(1, 65)),
      Uint8Array.from(b.slice(65)),
    ),
    "Funding wallet signature mismatch.",
  );
  return to64(signed);
}
