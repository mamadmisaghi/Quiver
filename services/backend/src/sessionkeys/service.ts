import { isLowS } from "../auth/lowS";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, toHex, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { z } from "zod";
import type { PrepareSessionKeyReq, SessionKeyDefaults, SessionKeyPolicy } from "../../contracts/src/api";
import { iso } from "../lib/clock";
import { usd } from "../lib/dec";
import { newId } from "../lib/ids";
import type { MemStore, SessionKeyRow } from "../store";
import type { Registry } from "../venues/registry";

export interface Target { address: string; label: string; selectors: string[] }
/**
 * Signer backends. local_dev/mock keeps throwaway keys in process memory only (never logged, never returned,
 * never persisted). Mainnet refuses local_dev at config load (fail closed).
 */
export class MockSigner {
  private keys = new Map<string, Hex>();
  create(id: string) { const pk = generatePrivateKey(); this.keys.set(id, pk); return privateKeyToAccount(pk).address; }
  destroy(id: string) { this.keys.delete(id); }
  has(id: string) { return this.keys.has(id); }
}
export class SessionKeyError extends Error { constructor(public code: "mode_not_enabled" | "validation_failed" | "session_key_policy_violation" | "not_found" | "session_key_cap_ratio" | "session_key_slippage_above_cap" | "session_key_expiry_too_long" | "session_key_policy_hash_mismatch" | "signing_unavailable", msg: string) { super(msg); } }

export const DEFAULT_SLIPPAGE_PCT = 1; export const MAX_SLIPPAGE_PCT = 10;
/** On-chain minimum notional per swap is windowCap/64; rounded UP to the cent so the UI never offers a size the contract rejects. */
export const minSwapUsd = (dailyCapUsd: number) => Math.ceil((dailyCapUsd * 100) / 64 - 1e-9) / 100;
/** M3.9: SessionAccount.MAX_SPENDS_PER_WINDOW — grant() reverts BadGrant unless windowCap <= 64 * perTxCap. */
export const MAX_DAILY_TO_PER_TRADE = 64;
export const DEFAULT_EXPIRY_HOURS = 24; export const MAX_EXPIRY_HOURS = 168;
export const sessionKeyDefaults = (perTradeCapUsd: number, dailyCapUsd: number, defaultExpiryHours = DEFAULT_EXPIRY_HOURS, maxExpiryHours = MAX_EXPIRY_HOURS): z.infer<typeof SessionKeyDefaults> =>
  ({ perTradeCapUsd, dailyCapUsd, minSwapUsd: minSwapUsd(dailyCapUsd), maxSlippagePct: DEFAULT_SLIPPAGE_PCT, defaultExpiryHours, maxExpiryHours, maxDailyToPerTradeRatio: MAX_DAILY_TO_PER_TRADE });
/** bps → percent; unset/invalid → 1%; never above 10% (contract bound). */
export const slippagePctFromBps = (bps: number | undefined) => (bps !== undefined && Number.isInteger(bps) && bps > 0 && bps <= MAX_SLIPPAGE_PCT * 100 ? bps / 100 : DEFAULT_SLIPPAGE_PCT);

const DOMAIN = (chainId: number) => ({ name: "Quiver Session Key", version: "1", chainId });
const TYPES = { SessionKeyGrant: [{ name: "sessionKey", type: "address" }, { name: "smartAccount", type: "address" }, { name: "policyHash", type: "bytes32" }, { name: "expiresAt", type: "uint64" }, { name: "maxSlippageBps", type: "uint16" }] } as const;
/** SessionAccount.grant ABI (foundry/src/SessionAccount.sol). */
export const GRANT_ABI = [{ type: "function", name: "grant", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "key", type: "address" }, { name: "expiry", type: "uint64" }, { name: "maxSlippageBps", type: "uint16" }, { name: "tokens", type: "address[]" }, { name: "perTxCaps", type: "uint128[]" }, { name: "windowCaps", type: "uint128[]" }] }] as const;
export interface GrantParams { key: string; expiry: number; maxSlippageBps: number; tokens: string[]; perTxCaps: string[]; windowCaps: string[] }
/** policyHash = keccak256(abi.encode(chainId, smartAccount, targetsHash, grant params)): binds the signed EIP-712 grant to the exact on-chain grant() call. */
export const policyHashOf = (chainId: number, smartAccount: string, targets: Target[], g: GrantParams) => keccak256(encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }, { type: "uint16" }, { type: "address[]" }, { type: "uint128[]" }, { type: "uint128[]" }],
  [BigInt(chainId), smartAccount as Hex, keccak256(toHex(JSON.stringify(targets.map((t) => [t.address.toLowerCase(), t.selectors])))), g.key as Hex, BigInt(g.expiry), g.maxSlippageBps, g.tokens as Hex[], g.perTxCaps.map(BigInt), g.windowCaps.map(BigInt)]));
export const grantCalldata = (g: GrantParams) => encodeFunctionData({ abi: GRANT_ABI, functionName: "grant", args: [g.key as Hex, BigInt(g.expiry), g.maxSlippageBps, g.tokens as Hex[], g.perTxCaps.map(BigInt), g.windowCaps.map(BigInt)] });
/** USD cap → token units (floor), using the token's USD price and decimals. */
const toUnits = (usdAmt: number, priceUsd: number, decimals: number) => (BigInt(Math.round(usdAmt * 1e6)) * 10n ** BigInt(decimals)) / BigInt(Math.max(1, Math.round(priceUsd * 1e6)));
const REVOKE_TYPES = { SessionKeyRevoke: [{ name: "sessionKey", type: "address" }, { name: "smartAccount", type: "address" }] } as const;

export class SessionKeyService {
  constructor(private store: MemStore, private reg: Registry, private signer: MockSigner,
    private opts: { mode: "mock" | "testnet" | "mainnet"; targets: () => Target[] | null; defaults: { maxDays?: number; perTxUsd: number; dailyUsd: number; defaultExpiryHours?: number; maxExpiryHours?: number }; now: () => number;
      /** M3.9: testnet signing needs the Alchemy Wallet APIs (ALCHEMY_API_KEY). false in testnet = 503 signing_unavailable. Ignored in mock. */
      signingAvailable?: boolean; /** test hook: bind to a deployed SessionAccount (anvil) */ smartAccountFor?: (owner: string) => string; priceUsd?: (instrumentId: string) => number | null }) {}

  /** Deterministic mock smart-account address for an owner (real: Alchemy MAv2 counterfactual address). */
  smartAccountFor(owner: string) { if (this.opts.smartAccountFor) return getAddress(this.opts.smartAccountFor(owner)); return getAddress("0x" + keccak256(toHex(`quiver-mock-sa:${owner.toLowerCase()}`)).slice(26)); }

  defaults() { return sessionKeyDefaults(this.opts.defaults.perTxUsd, this.opts.defaults.dailyUsd, this.defExpiryH(), this.maxExpiryH()); }
  private maxExpiryH() { return this.opts.defaults.maxExpiryHours ?? MAX_EXPIRY_HOURS; }
  private defExpiryH() { return Math.min(this.opts.defaults.defaultExpiryHours ?? DEFAULT_EXPIRY_HOURS, this.maxExpiryH()); }
  private needSigning() { if (this.opts.mode === "testnet" && !this.opts.signingAvailable) throw new SessionKeyError("signing_unavailable", "Wallet signing is temporarily unavailable on this server. Try again later."); }
  maxSlippagePctFor(smartAccount: string) { return slippagePctFromBps(this.store.accountSlippageCapBps.get(smartAccount.toLowerCase())); }

  prepare(userId: string, owner: string, req: z.infer<typeof PrepareSessionKeyReq>) {
    if (this.opts.mode === "mainnet") throw new SessionKeyError("mode_not_enabled", "Live session keys are not enabled yet.");
    if (req.chainId !== 46630) throw new SessionKeyError("mode_not_enabled", "Only Robinhood Chain testnet (46630) is enabled.");
    this.needSigning();
    const perTx = Number(req.perTxCapUsd), daily = Number(req.dailyCapUsd);
    if (!(perTx > 0) || daily < perTx) throw new SessionKeyError("validation_failed", "Daily cap must be ≥ per-trade cap > 0.");
    if (daily > MAX_DAILY_TO_PER_TRADE * perTx) throw new SessionKeyError("session_key_cap_ratio", `Daily cap can be at most ${MAX_DAILY_TO_PER_TRADE}× the per-trade cap ($${(MAX_DAILY_TO_PER_TRADE * perTx).toLocaleString("en-US")} for $${perTx.toLocaleString("en-US")} per trade).`);
    if (req.expiresInHours !== undefined && req.expiresInDays !== undefined) throw new SessionKeyError("validation_failed", "Send expiresInHours or expiresInDays, not both.");
    const hours = req.expiresInHours ?? (req.expiresInDays !== undefined ? req.expiresInDays * 24 : this.defExpiryH());
    if (hours > this.maxExpiryH()) throw new SessionKeyError("session_key_expiry_too_long", `Max expiry is ${this.maxExpiryH()} hours.`);
    const pct = req.maxSlippagePct ?? DEFAULT_SLIPPAGE_PCT; const bps = Math.round(pct * 100);
    if (Math.abs(bps - pct * 100) > 1e-6) throw new SessionKeyError("validation_failed", "maxSlippagePct must have at most 2 decimals (whole bps).");
    const targets = this.opts.targets();
    if (!targets || !targets.length) throw new SessionKeyError("mode_not_enabled", "No verified swap routers for this chain yet (fail closed). Run the testnet verification tasks first.");
    const tokens: string[] = [];
    for (const id of req.tokens) {
      const m = this.reg.get(id);
      if (!m || m.venue !== "robinhood") throw new SessionKeyError("validation_failed", `${id} is not a Robinhood Chain token.`);
      if (m.mock && this.opts.mode !== "mock") throw new SessionKeyError("session_key_policy_violation", `${m.symbol} address is unverified; refusing (fail closed).`);
      tokens.push(getAddress(id.split(":")[2]));
    }
    const smartAccount = this.smartAccountFor(owner); const cap = this.maxSlippagePctFor(smartAccount);
    if (pct > cap) throw new SessionKeyError("session_key_slippage_above_cap", `Max slippage is ${cap}% for this account.`);
    const units = req.tokens.map((t) => { const m = this.reg.get(t)!; const px = this.opts.priceUsd?.(t) ?? (this.opts.mode === "mock" ? m.base : null);
      if (!px || !(px > 0)) throw new SessionKeyError("mode_not_enabled", `No price for ${m.symbol}; cannot size on-chain caps (fail closed).`);
      const d = m.decimals ?? 18; const p = toUnits(perTx, px, d); let w = toUnits(daily, px, d); if (w > p * 64n) w = p * 64n; if (p === 0n) throw new SessionKeyError("validation_failed", "Per-trade cap is below one token unit.");
      return { p: p.toString(), w: w.toString() }; });
    const id = newId("sk"); const address = this.signer.create(id);
    const expiresAt = Math.floor((this.opts.now() + hours * 3_600_000) / 1000) * 1000;
    const grant: GrantParams = { key: address, expiry: expiresAt / 1000, maxSlippageBps: bps, tokens, perTxCaps: units.map((u) => u.p), windowCaps: units.map((u) => u.w) };
    const policyHash = policyHashOf(req.chainId, smartAccount, targets, grant);
    const policy: z.infer<typeof SessionKeyPolicy> = { chainId: req.chainId, allowedTargets: targets, allowedTokens: tokens, recipientMustBe: "self", perTxCapUsd: req.perTxCapUsd, dailyCapUsd: req.dailyCapUsd, expiresAt: iso(expiresAt), nativeTransfer: false, erc20Transfer: false, approveOnlyTargets: true, maxSlippagePct: pct, maxSlippageBps: bps };
    const typedData = { domain: DOMAIN(req.chainId), types: TYPES, primaryType: "SessionKeyGrant" as const, message: { sessionKey: address, smartAccount, policyHash, expiresAt: String(grant.expiry), maxSlippageBps: bps } };
    const install = { method: "wallet_sendCalls" as const, params: [{ version: "2.0.0", chainId: toHex(req.chainId), from: getAddress(owner), atomicRequired: true, calls: [{ to: smartAccount, data: grantCalldata(grant), value: "0x0" }] }] };
    const row: SessionKeyRow = { id, ownerId: userId, status: "pending", policy, address, smartAccount, typedData, createdAt: this.opts.now(), spent: { day: "", usd: 0 }, revokeTx: null, grant, policyHash, targets };
    this.store.sessionKeys.set(id, row);
    const syms = req.tokens.map((t) => this.reg.get(t)!.symbol);
    const humanReadable = [
      `Can swap on ${[...new Set(targets.map((t) => t.label))].join(" and ")} on Robinhood Chain${this.opts.mode === "mock" ? " (mock)" : " testnet"}`,
      `Only these tokens: ${syms.join(", ")}`,
      `Max slippage ${pct}% per swap`,
      `Up to $${Number(req.perTxCapUsd).toLocaleString("en-US")} per trade, $${Number(req.dailyCapUsd).toLocaleString("en-US")} per day`,
      `Expires ${new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`,
      "Cannot transfer or withdraw. Swap output always returns to your account.",
    ];
    return { sessionKeyId: id, sessionKeyAddress: address, smartAccount, policy, defaults: this.defaults(), humanReadable, policyHash, grant, signatureRequest: { type: "eth_signTypedData_v4" as const, data: typedData }, install };
  }

  /** Verify the owner's EIP-712 signature. Mock: activates immediately (real: after on-chain install confirms). */
  async submit(userId: string, owner: string, id: string, signature: string, policyHash?: string, installTxHash?: string) {
    this.needSigning();
    const row = this.get(userId, id);
    if (row.grant && row.targets && row.policyHash) {
      const recomputed = policyHashOf(row.policy.chainId, row.smartAccount, row.targets, row.grant);
      if (recomputed !== row.policyHash || (row.typedData as any).message.policyHash !== recomputed || (policyHash !== undefined && policyHash.toLowerCase() !== recomputed))
        throw new SessionKeyError("session_key_policy_hash_mismatch", "Policy hash does not match the prepared grant. Prepare again.");
    }
    if (row.status !== "pending") throw new SessionKeyError("validation_failed", `Session key is ${row.status}.`);
    const td = row.typedData as any;
    if (!isLowS(signature)) throw new SessionKeyError("session_key_policy_violation", "Signature must be a canonical (low-s) 65-byte wallet signature.");
    const ok = await verifyTypedData({ address: owner as Hex, domain: td.domain, types: td.types, primaryType: td.primaryType, message: { ...td.message, expiresAt: BigInt(td.message.expiresAt) }, signature: signature as Hex }).catch(() => false);
    if (!ok) throw new SessionKeyError("session_key_policy_violation", "Signature does not match your wallet.");
    if (this.opts.mode === "testnet") { row.installTx = installTxHash ?? null; this.store.audit.push({ at: this.opts.now(), userId, action: "session_key.signed", target: id }); return this.view(row); } // active after the indexer sees SessionGranted
    row.status = "active"; this.store.audit.push({ at: this.opts.now(), userId, action: "session_key.activate", target: id });
    return this.view(row);
  }
  revoke(userId: string, id: string) {
    const row = this.get(userId, id);
    row.status = "revoked"; this.signer.destroy(id); this.store.audit.push({ at: this.opts.now(), userId, action: "session_key.revoke", target: id });
    return { sessionKey: this.view(row), onchainRevoke: { signatureRequest: { type: "eth_signTypedData_v4", data: { domain: DOMAIN(row.policy.chainId), types: REVOKE_TYPES, primaryType: "SessionKeyRevoke", message: { sessionKey: row.address, smartAccount: row.smartAccount } } } } };
  }
  get(userId: string, id: string) { const r = this.store.sessionKeys.get(id); if (!r || r.ownerId !== userId) throw new SessionKeyError("not_found", "Session key not found."); this.refresh(r); return r; }
  refresh(r: SessionKeyRow) { if (r.status === "active" && Date.parse(r.policy.expiresAt) <= this.opts.now()) { r.status = "expired"; this.signer.destroy(r.id); } }
  spentToday(r: SessionKeyRow) { const d = new Date(this.opts.now()).toISOString().slice(0, 10); if (r.spent.day !== d) r.spent = { day: d, usd: 0 }; return r.spent.usd; }
  view(r: SessionKeyRow) { return { id: r.id, status: r.status, policy: { ...r.policy, maxSlippagePct: r.policy.maxSlippagePct ?? DEFAULT_SLIPPAGE_PCT, maxSlippageBps: r.policy.maxSlippageBps ?? Math.round((r.policy.maxSlippagePct ?? DEFAULT_SLIPPAGE_PCT) * 100) }, /* pre-M3.6.1 persisted rows */ createdAt: iso(r.createdAt), spentTodayUsd: usd(this.spentToday(r)), revokeTx: r.revokeTx, policyHash: r.policyHash ?? null, installTx: r.installTx ?? null }; }
}
export const MOCK_TARGETS: Target[] = [
  { address: "0x000000000000000000000000000000000000dEaD", label: "Uniswap Universal Router (MOCK)", selectors: ["0x3593564c"] },
];
