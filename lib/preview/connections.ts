import { SecretVault } from "@/services/backend/src/secrets/vault";
import { UserSecretView, AccountReadRes, EvmAddress } from "@/lib/contracts";

export type ConnectionKind = "ai_key" | "rpc" | "webhook";
type ConnectionRow = {
  id: string;
  owner: string;
  kind: ConnectionKind;
  label: string;
  hint: string;
  sealed: string;
  created: string;
  updated: string;
  used: string | null;
};
export const vault = () => new SecretVault(process.env.SECRETS_MASTER_KEY);
const aad = (owner: string, kind: ConnectionKind, id: string) =>
  JSON.stringify([owner, kind, id]);

export async function listConnections(db: D1Database, owner: string) {
  const rows = await db
    .prepare(
      "SELECT * FROM preview_connections WHERE owner = ? AND kind IN ('ai_key','rpc') ORDER BY created",
    )
    .bind(owner)
    .all<ConnectionRow>();
  return rows.results.map((row) =>
    UserSecretView.parse({
      id: row.id,
      kind: row.kind,
      label: row.label,
      hint: row.hint,
      chainId: row.kind === "rpc" ? 46630 : null,
      provider: row.kind === "ai_key" ? "openrouter" : null,
      status:
        vault().open(row.sealed, aad(owner, row.kind, row.id)) === null
          ? "undecryptable"
          : "ok",
      createdAt: row.created,
      updatedAt: row.updated,
      lastUsedAt: row.used,
    }),
  );
}
export async function saveConnection(
  db: D1Database,
  owner: string,
  kind: ConnectionKind,
  value: string,
  label: string,
  hint: string,
) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([owner, kind])),
  );
  const id =
    "sec_" +
    Array.from(new Uint8Array(hash).slice(0, 12), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const sealed = vault().seal(value, aad(owner, kind, id));
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO preview_connections (owner, kind, id, label, hint, sealed, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner,kind) DO UPDATE SET
    label=excluded.label, hint=excluded.hint, sealed=excluded.sealed, updated=excluded.updated, used=NULL`,
    )
    .bind(owner, kind, id, label, hint, sealed, now, now)
    .run();
  return id;
}
export async function openConnection(
  db: D1Database,
  owner: string,
  kind: ConnectionKind,
  markUsed = false,
) {
  const row = await db
    .prepare(
      "SELECT id,sealed FROM preview_connections WHERE owner=? AND kind=?",
    )
    .bind(owner, kind)
    .first<{ id: string; sealed: string }>();
  if (!row) return null;
  const value = vault().open(row.sealed, aad(owner, kind, row.id));
  if (value === null)
    throw new Error("Re-enter your saved connection in Settings.");
  if (markUsed)
    await db
      .prepare(
        "UPDATE preview_connections SET used=? WHERE owner=? AND kind=? AND sealed=?",
      )
      .bind(new Date().toISOString(), owner, kind, row.sealed)
      .run();
  return value;
}
export function approvedRpc(raw: string) {
  const u = new URL(raw);
  const explicit = (process.env.QUIVER_RPC_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    u.port ||
    !(
      u.hostname === "rpc.testnet.chain.robinhood.com" ||
      u.hostname.endsWith(".g.alchemy.com") ||
      explicit.includes(u.hostname)
    )
  )
    throw new Error(
      "Use the Robinhood Chain testnet RPC or an approved Alchemy endpoint.",
    );
  return u;
}
async function rpc(url: URL, method: string, params: string[]) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("RPC unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty RPC response");
  const decoder = new TextDecoder();
  let total = 0,
    data = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 180000) {
        await reader.cancel();
        throw new Error("RPC response too large");
      }
      data += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(data + decoder.decode()).result;
  if (typeof result !== "string" || !/^0x[0-9a-f]*$/i.test(result))
    throw new Error("Invalid RPC result");
  return result;
}
export async function verifyRpc(raw: string) {
  const u = approvedRpc(raw);
  if (BigInt(await rpc(u, "eth_chainId", [])) !== BigInt(46630))
    throw new Error("The endpoint must serve Robinhood Chain testnet 46630.");
  return u;
}
export async function readAccount(raw: string, address: string) {
  EvmAddress.parse(address);
  const url = await verifyRpc(raw);
  const block = await rpc(url, "eth_blockNumber", []);
  const [balance, code] = await Promise.all([
    rpc(url, "eth_getBalance", [address, block]),
    rpc(url, "eth_getCode", [address, block]),
  ]);
  const hasCode = code.length > 2;
  return AccountReadRes.parse({
    chainId: 46630,
    address,
    blockNumber: BigInt(block).toString(),
    nativeBalanceWei: BigInt(balance).toString(),
    readOnly: true,
    hasCode,
    codeCheck: hasCode ? "unchecked" : "no_code",
    account: null,
  });
}
