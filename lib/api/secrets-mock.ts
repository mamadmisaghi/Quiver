// MOCK M5.9 user secrets. Keeps only hints (never the value), like the server's view.
import { ApiErr, type QuiverSecretsApi, type UserSecretView } from "./types";
const items: UserSecretView[] = []; let n = 0;
const now = () => new Date().toISOString();
const upsert = (kind: UserSecretView["kind"], label: string, hint: string, chainId: number | null, provider: string | null) => {
  const i = items.findIndex((x) => x.kind === kind); const t = now();
  const v: UserSecretView = { id: i >= 0 ? items[i].id : `sec_mock${String(++n).padStart(8, "0")}`, kind, chainId, provider, label, hint, status: "ok", createdAt: i >= 0 ? items[i].createdAt : t, updatedAt: t, lastUsedAt: null };
  if (i >= 0) items[i] = v; else items.push(v); return v;
};
export const mockSecrets: QuiverSecretsApi = {
  // MOCK M5.13 chain account read: an empty testnet EOA; uses "user" when a mock RPC is saved.
  async chainAccount(address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ApiErr("validation_failed", "Not an EVM address.", 422);
    return { res: { chainId: 46630, address, readOnly: true, blockNumber: "1234567", nativeBalanceWei: "0", hasCode: false, codeCheck: "no_code", account: null }, rpc: items.some((x) => x.kind === "rpc") ? "user" : "server" };
  },
  async mySecrets() { return { vault: "ok", items: items.map((x) => ({ ...x })) }; },
  async putRpcSecret(b) {
    let u: URL; try { u = new URL(b.url); } catch { throw new ApiErr("validation_failed", "Enter a valid URL.", 422); }
    if (u.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) throw new ApiErr("rpc_url_blocked", "RPC URLs must be public https addresses.", 422);
    return upsert("rpc", b.label || `Chain ${b.chainId} RPC`, `https://${u.host}/…`, b.chainId, null);
  },
  async putAiSecret(b) {
    if (!/^sk-or-[A-Za-z0-9_-]{16,200}$/.test(b.apiKey)) throw new ApiErr("validation_failed", "That doesn’t look like an OpenRouter key (sk-or-…).", 422);
    return upsert("ai_key", b.label || "OpenRouter key", `sk-or-…${b.apiKey.slice(-4)}`, null, b.provider);
  },
  async deleteSecret(id) { const i = items.findIndex((x) => x.id === id); if (i < 0) throw new ApiErr("not_found", "Secret not found.", 404); items.splice(i, 1); },
};
