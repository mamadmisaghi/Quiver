import { randomBytes } from "node:crypto";
import {
  getAddress,
  isAddress,
  recoverAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { User } from "../store";
import { HostError } from "../workflows/host";
import type { SecretVault } from "../secrets/vault";
import type { Action, Network } from "./live-program";
import {
  approvalDigest,
  HyperliquidVenue,
  revocationReplacement,
  type Grant,
  type L1Action,
} from "./hyperliquid-testnet";
import { isLowS } from "../auth/lowS";

const hour = 3600000,
  day = hour * 24;
const countryCode = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Z]{2}$/.test(s) && s !== "XX";
const productionIdentity = (u: User | undefined) =>
  !!u && /^privy:did:privy:[a-zA-Z0-9_-]{6,64}$/.test(u.label);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const moneyLimit = (max: number) =>
  z
    .number()
    .min(0.000001)
    .max(max)
    .refine(
      (v) => /^\d+(?:\.\d{1,6})?$/.test(String(v)),
      "Use at most six decimal places.",
    );
function usdUnits(v: number) {
  const [whole, frac = ""] = String(v).split(".");
  return BigInt(whole) * 1000000n + BigInt(frac.padEnd(6, "0"));
}
export const LiveLimits = z
  .object({
    maxOrderUsd: moneyLimit(100000),
    dailyUsd: moneyLimit(1000000),
    maxLeverage: z.number().int().min(1).max(100),
    maxSlippageBps: z.number().int().min(1).max(500),
  })
  .strict();
type Limits = z.infer<typeof LiveLimits>;
type Consent = {
  version: string;
  at: number;
  residence: string;
  nonUs: boolean;
  limits: Limits;
};
type VenueGrant = {
  owner: Address;
  grant: Grant;
  sealed: string;
  state: "pending" | "checking" | "active" | "disabled" | "revoked";
  lastNonce: number;
  requestedHours?: number;
  lastVerifiedAt?: number;
  unknownApprovalUntil?: number;
  revokeNonce?: number;
  revokeAttempted?: boolean;
};
export type LiveAccess = {
  paused: boolean;
  consent?: Consent;
  trustedCountry?: string;
  regionAt?: number;
  agent?: VenueGrant;
  ownerNonces?: Record<string, number>;
  baselines?: Record<
    string,
    { day: string; opening: number; latest: number; high: number }
  >;
};
type Store = {
  users: Map<string, User>;
  liveAccess: Map<string, LiveAccess>;
  executionAccounts: ReadonlyMap<string, { paused?: boolean }>;
};
type Options = {
  store: Store;
  vault: SecretVault;
  venue: HyperliquidVenue;
  now: () => number;
  enabled: () => boolean;
  commit: () => Promise<void>;
  terms: string;
  blockedStocks: string[];
  blockedPerps: string[];
  maxDailyUsd: number;
};
type Agreement = {
  version: string;
  residence: string;
  nonUs: boolean;
  acceptRealFunds: true;
  limits: Limits;
};
export class LiveAuthority {
  constructor(readonly d: Options) {
    if (d.venue.network !== "mainnet")
      throw Error("Live authority requires the Hyperliquid mainnet transport.");
  }
  record(uid: string) {
    let row = this.d.store.liveAccess.get(uid);
    if (!row) {
      row = { paused: false };
      this.d.store.liveAccess.set(uid, row);
    }
    return row;
  }
  signedUser(u: User) {
    const stored = this.d.store.users.get(u.id);
    if (!productionIdentity(stored) || stored?.label !== u.label)
      throw new HostError(403, "Sign in with a verified production account.");
  }
  writable() {
    if (!this.d.enabled())
      throw new HostError(503, "The durable mainnet service is unavailable.");
  }
  linked(uid: string, wallet: string, network: Network) {
    const u = this.d.store.users.get(uid);
    if (!u || !productionIdentity(u)) return false;
    if (network === "solana-mainnet")
      return !!u.solanaWallets?.includes(wallet);
    return (
      (network === "robinhood-mainnet" || network === "hyperliquid-mainnet") &&
      isAddress(wallet, { strict: false }) &&
      !same(wallet, zeroAddress) &&
      !!u.linkedWallets?.some((x) => same(x.address, wallet))
    );
  }
  /** The caller supplies only the result of verifiedEdgeCountry. Never consume client country headers here. */
  noteRegion(uid: string, country: string | null) {
    if (
      !countryCode(country) ||
      !productionIdentity(this.d.store.users.get(uid))
    )
      return false;
    const a = this.record(uid),
      changed = a.trustedCountry !== country;
    a.trustedCountry = country;
    a.regionAt = this.d.now();
    return changed;
  }
  agree(u: User, b: Agreement, country: string | null) {
    this.signedUser(u);
    this.writable();
    const limits = LiveLimits.safeParse(b.limits);
    if (
      !limits.success ||
      b.version !== this.d.terms ||
      b.acceptRealFunds !== true ||
      typeof b.nonUs !== "boolean" ||
      !countryCode(b.residence) ||
      limits.data.maxOrderUsd > limits.data.dailyUsd ||
      limits.data.dailyUsd > this.d.maxDailyUsd
    ) {
      throw new HostError(
        422,
        "Review the current trading disclosures and account limits.",
      );
    }
    if (!countryCode(country) || country !== b.residence)
      throw new HostError(
        403,
        "The declared residence must match the verified network country.",
      );
    this.noteRegion(u.id, country);
    const a = this.record(u.id);
    a.consent = {
      version: b.version,
      at: this.d.now(),
      residence: b.residence,
      nonUs: b.nonUs,
      limits: limits.data,
    };
    a.paused = false;
    const user = this.d.store.users.get(u.id)! as User & {
      declaredResidence?: string;
    };
    user.declaredResidence = b.residence;
    user.termsVersion = b.version;
    user.eligibility.selfDeclaredNonUsPerson = b.nonUs;
    return this.public(u);
  }
  /** Compatibility alias for the account controller. */
  consent(u: User, b: Agreement, country: string | null) {
    return this.agree(u, b, country);
  }
  eligible(uid: string, network: Network, reducing = false) {
    const a = this.d.store.liveAccess.get(uid),
      u = this.d.store.users.get(uid),
      c = a?.consent;
    if (
      !u ||
      !productionIdentity(u) ||
      !a ||
      !c ||
      c.version !== this.d.terms ||
      !countryCode(c.residence) ||
      c.residence !== a.trustedCountry ||
      !Number.isSafeInteger(a.regionAt) ||
      typeof a.regionAt !== "number" ||
      a.regionAt > this.d.now() + 1000 ||
      a.regionAt < this.d.now() - 7 * day ||
      (!reducing &&
        (a.paused || this.d.store.executionAccounts.get(uid)?.paused))
    )
      return false;
    if (network === "robinhood-mainnet")
      return c.nonUs && !this.d.blockedStocks.includes(c.residence);
    if (network === "hyperliquid-mainnet")
      return c.nonUs && !this.d.blockedPerps.includes(c.residence);
    return network === "solana-mainnet";
  }
  require(uid: string, network: Network, wallet: string) {
    this.writable();
    if (!this.linked(uid, wallet, network) || !this.eligible(uid, network)) {
      throw new HostError(
        403,
        "Link the selected wallet and verify your eligibility for this venue.",
      );
    }
  }
  allow(uid: string, a: Action) {
    const c = this.d.store.liveAccess.get(uid)?.consent;
    const closing = a.leg === "exit" && a.reduceOnly;
    if (
      !c ||
      a.owner !== uid ||
      !this.d.enabled() ||
      !this.linked(uid, a.wallet, a.network) ||
      !this.eligible(uid, a.network, closing) ||
      !Number.isInteger(a.slippageBps) ||
      a.slippageBps < 1 ||
      a.slippageBps > c.limits.maxSlippageBps ||
      !Number.isInteger(a.leverage) ||
      a.leverage < 1 ||
      (!closing && a.leverage > c.limits.maxLeverage)
    )
      return false;
    if (closing) return true;
    // The coordinator pins the independent market mark for token sales and includes leverage in USD6 for derivatives.
    // A raw token-unit amount cannot stand in for a USD-denominated limit.
    return (
      !!a.notionalUsd6 &&
      /^[1-9]\d{0,77}$/.test(a.notionalUsd6) &&
      BigInt(a.notionalUsd6) <= usdUnits(c.limits.maxOrderUsd)
    );
  }
  public(u: User) {
    this.signedUser(u);
    const a = this.d.store.liveAccess.get(u.id),
      g = a?.agent;
    return {
      termsVersion: this.d.terms,
      platformDailyCapUsd: this.d.maxDailyUsd,
      consent: a?.consent ?? null,
      paused: !!(a?.paused || this.d.store.executionAccounts.get(u.id)?.paused),
      region: a?.trustedCountry ?? null,
      evmWallets: (u.linkedWallets ?? []).map((w) => w.address),
      solanaWallets: u.solanaWallets ?? [],
      agent: g
        ? {
            master: g.owner,
            agent: g.grant.agent,
            slotName: g.grant.name,
            nonce: g.grant.nonce,
            validUntil: g.grant.validUntil,
            lastVerifiedAt: g.lastVerifiedAt ?? null,
            state:
              g.state !== "revoked" && g.grant.validUntil <= this.d.now()
                ? "expired"
                : g.state,
          }
        : null,
    };
  }
  pause(u: User) {
    this.signedUser(u);
    const a = this.record(u.id);
    a.paused = true;
    if (a.agent) {
      a.agent.sealed = "";
      if (a.agent.state !== "revoked") a.agent.state = "disabled";
    }
  }
  private aad(uid: string, agent: Address) {
    return [uid, "mainnet", "hyperliquid", agent.toLowerCase()].join(":");
  }
  private claimOwnerNonces(uid: string, wallet: string, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 4)
      throw new HostError(422, "Invalid owner nonce count.");
    const address = wallet.toLowerCase(),
      now = this.d.now();
    let prev = 0;
    for (const a of this.d.store.liveAccess.values())
      prev = Math.max(prev, a.ownerNonces?.[address] ?? 0);
    const first = Math.max(now, prev + 1),
      end = first + count - 1;
    if (!Number.isSafeInteger(end) || end > now + 1800)
      throw new HostError(429, "Wait for the current wallet signing window.");
    const a = this.record(uid);
    (a.ownerNonces ??= {})[address] = end;
    return first;
  }
  async reserveOwnerNonces(uid: string, wallet: Address, count: number) {
    this.require(uid, "hyperliquid-mainnet", wallet);
    const nonce = this.claimOwnerNonces(uid, wallet, count);
    await this.d.commit();
    return nonce;
  }
  cancelAllowed(uid: string, wallet: Address) {
    return this.d.enabled() && this.linked(uid, wallet, "hyperliquid-mainnet");
  }
  newGrant(u: User, master: Address, hours: number) {
    this.signedUser(u);
    this.require(u.id, "hyperliquid-mainnet", master);
    if (!this.d.vault.available)
      throw new HostError(503, "The encrypted signer is unavailable.");
    if (!Number.isInteger(hours) || hours < 1 || hours > 24)
      throw new HostError(
        422,
        "Choose an agent lifetime between 1 and 24 hours.",
      );
    const a = this.record(u.id),
      old = a.agent,
      now = this.d.now();
    if (old && old.state !== "revoked" && old.grant.validUntil > now) {
      if (old.state === "pending" && old.grant.nonce + 270000 > now) {
        if (!same(old.owner, master))
          throw new HostError(
            409,
            "A grant is already pending for another wallet.",
          );
        if (
          (old.requestedHours ??
            Math.round((old.grant.validUntil - old.grant.nonce) / hour)) !==
          hours
        ) {
          throw new HostError(
            409,
            "Discard the pending grant before choosing another lifetime.",
          );
        }
        return this.prompt(old);
      }
      if (old.state !== "pending")
        throw new HostError(
          409,
          "Reconcile or revoke the existing named agent before replacing it.",
        );
    }
    if (
      [...this.d.store.liveAccess.entries()].some(
        ([uid, r]) =>
          uid !== u.id &&
          r.agent &&
          same(r.agent.owner, master) &&
          r.agent.state !== "revoked" &&
          r.agent.grant.validUntil > now,
      )
    ) {
      throw new HostError(409, "This wallet already has a Quiver grant.");
    }
    const key = generatePrivateKey(),
      agent = privateKeyToAccount(key).address;
    const grant = {
      agent,
      name: "Quiver" + randomBytes(4).toString("hex"),
      nonce: this.claimOwnerNonces(u.id, master, 1),
      validUntil: now + hours * hour,
    };
    a.agent = {
      owner: getAddress(master),
      grant,
      sealed: this.d.vault.seal(key, this.aad(u.id, agent)),
      state: "pending",
      requestedHours: hours,
      lastNonce: 0,
    };
    return this.prompt(a.agent);
  }
  private prompt(g: VenueGrant) {
    return {
      purpose: "authorize" as const,
      network: "mainnet" as const,
      master: g.owner,
      agent: g.grant.agent,
      slotName: g.grant.name,
      validUntil: g.grant.validUntil,
      typedData: this.d.venue.walletApprovalPayload(g.grant),
      expiresAt: g.grant.nonce + 300000,
    };
  }
  private async verifyOwner(grant: Grant, signature: Hex, owner: Address) {
    if (!isLowS(signature))
      throw new HostError(422, "Invalid wallet signature.");
    const recovered = await recoverAddress({
      hash: approvalDigest(grant, "mainnet"),
      signature,
    }).catch(() => null);
    if (!recovered || !same(recovered, owner))
      throw new HostError(
        403,
        "The signature does not authorize these mainnet grant terms.",
      );
  }
  async activate(u: User, signature: Hex) {
    this.signedUser(u);
    const row = this.record(u.id),
      g = row.agent;
    if (!g) throw new HostError(404, "Grant not found.");
    this.require(u.id, "hyperliquid-mainnet", g.owner);
    if (g.state === "active" && g.grant.validUntil > this.d.now())
      return this.public(u);
    if (
      !["pending", "checking"].includes(g.state) ||
      !g.sealed ||
      g.grant.validUntil <= this.d.now()
    )
      throw new HostError(409, "This grant is no longer pending.");
    await this.verifyOwner(g.grant, signature, g.owner);
    if (row.agent !== g || !g.sealed || row.paused)
      throw new HostError(409, "The local grant changed.");
    if (g.state === "pending") {
      if (
        g.grant.nonce > this.d.now() + 2000 ||
        this.d.now() > g.grant.nonce + 300000
      )
        throw new HostError(409, "The grant challenge expired.");
      g.state = "checking";
      g.unknownApprovalUntil = g.grant.nonce + 300000;
      await this.d.commit();
      this.require(u.id, "hyperliquid-mainnet", g.owner);
      if (row.agent !== g || !g.sealed || g.state !== "checking")
        throw new HostError(409, "The grant was stopped.");
      await this.d.venue.approve(g.grant, signature, g.owner);
    }
    // A retry of an ambiguous approval performs only the venue reads below.
    if (!(await this.d.venue.activeGrant(g.grant, g.owner)))
      throw new HostError(
        409,
        "The exchange has not confirmed the named agent.",
      );
    this.require(u.id, "hyperliquid-mainnet", g.owner);
    if (row.agent !== g || g.state !== "checking" || !g.sealed)
      throw new HostError(409, "The grant was stopped.");
    g.state = "active";
    g.lastVerifiedAt = this.d.now();
    delete g.unknownApprovalUntil;
    await this.d.commit();
    return this.public(u);
  }
  /** Read-only exchange recovery. It never repeats the owner grant/revoke action. */
  async refreshGrant(u: User) {
    this.signedUser(u);
    const row = this.record(u.id),
      g = row.agent;
    if (!g || g.state === "pending" || g.state === "revoked")
      return this.public(u);
    if (!this.linked(u.id, g.owner, "hyperliquid-mainnet"))
      throw new HostError(403, "The owner wallet is no longer linked.");
    const role = await this.d.venue.activeGrant(g.grant, g.owner);
    if (row.agent !== g) return this.public(u);
    if (
      role &&
      g.sealed &&
      (g.state === "checking" || g.state === "active") &&
      this.eligible(u.id, "hyperliquid-mainnet")
    ) {
      g.state = "active";
      g.lastVerifiedAt = this.d.now();
      delete g.unknownApprovalUntil;
    } else if (
      !role &&
      (g.unknownApprovalUntil ?? 0) <= this.d.now() &&
      (await this.d.venue.revocationConfirmed(g.grant, g.owner))
    ) {
      if (row.agent !== g) return this.public(u);
      g.state = "revoked";
      g.sealed = "";
      g.lastVerifiedAt = this.d.now();
      delete g.unknownApprovalUntil;
    }
    await this.d.commit();
    return this.public(u);
  }
  isCurrentAgent(uid: string, wallet: Address, agent: Address) {
    const g = this.d.store.liveAccess.get(uid)?.agent;
    return (
      !!g &&
      g.state === "active" &&
      !!g.sealed &&
      g.grant.validUntil > this.d.now() &&
      same(g.owner, wallet) &&
      same(g.grant.agent, agent)
    );
  }
  async active(uid: string, wallet: Address) {
    const g = this.d.store.liveAccess.get(uid)?.agent;
    const valid = () =>
      !!g &&
      this.d.enabled() &&
      this.linked(uid, wallet, "hyperliquid-mainnet") &&
      this.eligible(uid, "hyperliquid-mainnet") &&
      this.isCurrentAgent(uid, wallet, g.grant.agent);
    return (
      !!g &&
      valid() &&
      (await this.d.venue.activeGrant(g.grant, g.owner)) &&
      valid()
    );
  }
  async sign(
    uid: string,
    wallet: Address,
    action: L1Action,
    expiresAt: number,
  ) {
    const row = this.record(uid),
      g = row.agent;
    if (!g || !(await this.active(uid, wallet)))
      throw new HostError(403, "The mainnet agent is inactive.");
    const now = this.d.now(),
      nonce = Math.max(now, g.lastNonce + 1),
      expiry = Math.min(expiresAt, nonce + 15000);
    if (!Number.isSafeInteger(expiry) || expiry <= nonce || nonce > now + 1800)
      throw new HostError(409, "The order signature window expired.");
    if (
      action.type === "updateLeverage" &&
      action.leverage > row.consent!.limits.maxLeverage
    )
      throw new HostError(403, "Leverage exceeds your current live limit.");
    g.lastNonce = nonce;
    await this.d.commit();
    this.require(uid, "hyperliquid-mainnet", wallet);
    if (row.agent !== g || !this.isCurrentAgent(uid, wallet, g.grant.agent))
      throw new HostError(409, "The signing grant changed.");
    const plain = this.d.vault.open(g.sealed, this.aad(uid, g.grant.agent));
    if (!plain) throw new HostError(503, "The mainnet signer is unavailable.");
    const signer = privateKeyToAccount(plain as Hex);
    if (!same(signer.address, g.grant.agent))
      throw new HostError(
        409,
        "The stored signer does not match the approved agent.",
      );
    const signed = await this.d.venue.sign(action, nonce, expiry, (data) =>
      signer.signTypedData(data),
    );
    if (
      row.agent !== g ||
      !this.isCurrentAgent(uid, wallet, g.grant.agent) ||
      !this.eligible(uid, "hyperliquid-mainnet")
    )
      throw new HostError(409, "The signing grant changed.");
    return { signed, agent: g.grant.agent };
  }
  revokePrompt(u: User) {
    this.signedUser(u);
    this.writable();
    const g = this.record(u.id).agent;
    if (!g || !this.linked(u.id, g.owner, "hyperliquid-mainnet"))
      throw new HostError(404, "Linked grant not found.");
    g.sealed = "";
    if (g.state === "revoked") return { revoked: true as const };
    g.state = "disabled";
    if (!g.revokeNonce || this.d.now() > g.revokeNonce + 55000) {
      g.revokeNonce = this.claimOwnerNonces(u.id, g.owner, 1);
      g.revokeAttempted = false;
    }
    const sink = revocationReplacement(
      g.grant,
      g.owner,
      g.revokeNonce,
      "mainnet",
    );
    return {
      purpose: "revoke" as const,
      network: "mainnet" as const,
      master: g.owner,
      agent: sink.agent,
      slotName: sink.name,
      validUntil: sink.validUntil,
      expiresAt: sink.validUntil,
      typedData: this.d.venue.walletRevocationPayload(
        g.grant,
        g.owner,
        g.revokeNonce,
      ),
    };
  }
  async revoke(u: User, signature: Hex) {
    this.signedUser(u);
    this.writable();
    const g = this.record(u.id).agent;
    if (g?.state === "revoked") return this.public(u);
    if (
      !g ||
      g.state !== "disabled" ||
      !g.revokeNonce ||
      !this.linked(u.id, g.owner, "hyperliquid-mainnet")
    )
      throw new HostError(409, "Request an owner revocation first.");
    const nonce = g.revokeNonce,
      sink = revocationReplacement(g.grant, g.owner, nonce, "mainnet");
    // Preserve retry capability after a lost acknowledgement. Never resend an ambiguous replacement.
    await this.verifyOwner(sink, signature, g.owner);
    if (await this.d.venue.revocationConfirmed(g.grant, g.owner)) {
      if ((g.unknownApprovalUntil ?? 0) > this.d.now())
        throw new HostError(
          409,
          "Waiting for the original grant's acceptance window to close.",
        );
    } else {
      if (!g.revokeAttempted) {
        if (this.d.now() >= sink.validUntil || g.revokeNonce !== nonce)
          throw new HostError(409, "The revocation window expired.");
        g.revokeAttempted = true;
        await this.d.commit();
        await this.d.venue.revoke(g.grant, g.owner, nonce, signature);
      }
      if (!(await this.d.venue.revocationConfirmed(g.grant, g.owner)))
        return this.public(u);
    }
    g.state = "revoked";
    delete g.unknownApprovalUntil;
    await this.d.commit();
    return this.public(u);
  }
}
