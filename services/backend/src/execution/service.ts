import {
  createProgram,
  executableSymbol,
  observeProgram,
  testnetIssues,
  type TestnetProgram,
} from "./testnet-workflow";
import type { Strategy } from "../../contracts/src/strategy";
import type { PaperQuote } from "../workflows/paper";
import { createHash, randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseUnits, type Address, type Hex } from "viem";
import { z } from "zod";
import type { MemStore, User } from "../store";
import { SecretVault } from "../secrets/vault";
import { HostError } from "../workflows/host";
import {
  HyperliquidTestnet,
  iocLimit,
  sizeFromNotional,
  perpOrder,
  cancelByCloid,
  updateLeverage,
  signTestnet,
  walletApprovalPayload,
  type Grant,
  type Perp,
  type L1Action,
} from "./hyperliquid-testnet";
import { createLedger, transition, type Ledger, type JournalEvent } from "./ledger";
import { ownershipMessage, verifyLink, type LinkChallenge } from "./solana-wire";
import type { PinnedOrder, Settlement } from "./solana-jupiter";

type Agent = {
  master: Address;
  grant: Grant;
  sealed: string;
  state: "pending" | "checking" | "active" | "disabled";
  lastNonce: number;
};
type Terms = {
  id: string;
  owner: Address;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  marginUsd: number;
  slippageBps: number;
  market: Perp;
  quantity: string;
  limit: string;
  cloid: string;
  expiresAt: number;
  digest: string;
};
type VenueOrder = { terms: Terms; ledger: Ledger; lastCheck: number; cancelRequested?: boolean };
export type ExecutionAccount = {
  paused?: boolean;
  programs?: TestnetProgram[];
  challenge?: LinkChallenge;
  agent?: Agent;
  orders: VenueOrder[];
  swaps?: { pin: PinnedOrder; txid?: string; receipt?: Settlement }[];
};
export const OrderInput = z
  .object({
    symbol: z.string().regex(/^(?:[a-z0-9]{1,16}:)?[A-Za-z0-9._-]{1,24}$/),
    side: z.enum(["long", "short"]),
    leverage: z.number().int().min(1).max(30),
    marginUsd: z.number().int().min(12).max(200),
    slippageBps: z.number().int().min(1).max(100),
  })
  .strict();
type Options = {
  store: MemStore;
  vault: SecretVault;
  venue: HyperliquidTestnet;
  now: () => number;
  durable: () => boolean;
  enabled: () => boolean;
  commit: () => Promise<void>;
  origin?: string;
};
const token = () => randomBytes(16).toString("hex");
const terminal = (o: VenueOrder) =>
  ["filled", "cancelled", "rejected", "revoked"].includes(o.ledger.orders[0].status);
const units = (s: string) => parseUnits(s, 18);
const scale = 10n ** 18n;
function apply(o: VenueOrder, e: JournalEvent) {
  const t = transition(o.ledger, e);
  o.ledger = t.next;
  return t.send;
}
export class ExecutionService {
  private busy = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private sweep?: Promise<void>;
  private stopped = false;
  startMonitor() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.sweep || this.stopped || !this.d.durable()) return;
      this.sweep = this.poll()
        .catch(() => {})
        .finally(() => {
          this.sweep = undefined;
        });
    }, 20000);
    this.timer.unref?.();
  }
  async stopMonitor() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.sweep;
  }
  private async poll() {
    const pending = [...this.d.store.executionAccounts]
      .flatMap(([uid, a]) =>
        a.orders
          .filter((o) => o.ledger.orders[0].dispatched && !terminal(o) && this.d.now() - o.lastCheck >= 20000)
          .map((o) => ({ uid, o })),
      )
      .sort((a, b) => a.o.lastCheck - b.o.lastCheck)
      .slice(0, 12);
    for (const { uid, o } of pending) {
      if (this.stopped || !this.d.durable()) break;
      const user = this.d.store.users.get(uid);
      if (!user || this.busy.has(uid)) continue;
      try {
        await this.exclusive(uid, () => this.reconcile(user, o.terms.id));
      } catch {
        o.lastCheck = this.d.now();
      }
    }
    let ran = false;
    for (const [uid, a] of this.d.store.executionAccounts) {
      const u = this.d.store.users.get(uid);
      if (
        !u ||
        this.busy.has(uid) ||
        this.stopped ||
        !this.d.durable() ||
        !a.programs?.some((p) => p.status === "running")
      )
        continue;
      await this.exclusive(uid, async () => {
        for (const p of a.programs ?? [])
          if (p.status === "running") {
            if (this.stopped) break;
            ran = true;
            try {
              await this.driveProgram(u, p);
            } catch (e) {
              p.pendingReason = e instanceof HostError ? e.message : "Waiting for verified testnet data.";
            }
          }
      });
    }
    if ((pending.length || ran) && this.d.durable()) await this.d.commit();
  }
  async startProgram(
    u: User,
    strategyId: string,
    version: number,
    st: Strategy,
    mode: TestnetProgram["mode"],
  ) {
    const g = this.agent(u),
      a = this.record(u.id);
    const issues = testnetIssues(st);
    if (issues.length) throw new HostError(422, issues[0]);
    const programs = (a.programs ??= []);
    const existing = programs.find((p) => p.status === "running");
    if (existing) {
      if (existing.strategyId === strategyId && existing.version === version && existing.mode === mode)
        return this.view(u);
      throw new HostError(409, "Stop the active testnet workflow first.");
    }
    if (programs.length >= 50) throw new HostError(429, "Testnet workflow retention limit reached.");
    const bal = await this.d.venue.account(g.master);
    if (units(bal.withdrawable) < units(String(st.workflow!.budgetUsd)))
      throw new HostError(422, "The strategy budget exceeds available testnet collateral.");
    if (!(await this.d.venue.activeGrant(g.grant, g.master)))
      throw new HostError(403, "The exchange could not verify the grant.");
    programs.push(
      createProgram(
        token(),
        strategyId,
        version,
        st,
        g.master,
        g.grant.agent,
        mode,
        this.d.now(),
        Number(bal.equity),
      ),
    );
    return this.view(u);
  }
  stopProgram(u: User, id: string) {
    const a = this.record(u.id),
      p = a.programs?.find((p) => p.id === id);
    if (!p) throw new HostError(404, "Testnet workflow not found.");
    p.status = "stopped";
    p.pendingReason = "Stopped. Existing venue positions stay open.";
    for (const order of a.orders)
      if (Object.values(p.stageOrders).includes(order.terms.id) && !order.ledger.orders[0].dispatched)
        apply(order, { kind: "revoke", id: order.terms.id });
    return this.view(u);
  }
  private async lossGuard(u: User, p: TestnetProgram) {
    const a = this.agent(u);
    if (
      a.master.toLowerCase() !== p.master.toLowerCase() ||
      a.grant.agent.toLowerCase() !== p.agent.toLowerCase()
    ) {
      p.status = "stopped";
      throw new HostError(403, "The strategy's signing grant changed.");
    }
    const bal = await this.d.venue.account(a.master),
      equity = Number(bal.equity),
      day = new Date(this.d.now()).toISOString().slice(0, 10);
    if (!Number.isFinite(equity) || equity <= 0) throw new HostError(409, "Account equity is unavailable.");
    if (day !== p.day) {
      p.day = day;
      p.openingEquity = equity;
    }
    const risk = { ...p.strategy.risk, ...p.strategy.workflow!.risk };
    if (p.openingEquity - equity >= (p.strategy.workflow!.budgetUsd! * risk.maxDailyLossPct) / 100) {
      p.status = "stopped";
      throw new HostError(409, "The daily testnet loss limit was reached.");
    }
  }
  async driveProgram(u: User, p: TestnetProgram) {
    if (p.status !== "running") return;
    await this.lossGuard(u, p);
    const w = p.strategy.workflow!,
      quotes = (
        await Promise.all(
          w.assets.map(async (asset) => {
            try {
              return {
                assetId: asset.id,
                ...(await this.d.venue.midpoint(executableSymbol(asset)!)),
                source: "Hyperliquid testnet book",
                synthetic: false,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((q) => q !== null) as PaperQuote[];
    const eligible = observeProgram(p, quotes, this.d.now()),
      a = this.record(u.id);
    const orderFor = (stage: string) => a.orders.find((o) => o.terms.id === p.stageOrders[stage]);
    const statusFor = (stage: string) => orderFor(stage)?.ledger.orders[0].status;
    if (w.stages.every((s) => statusFor(s.id) === "filled")) {
      p.status = "completed";
      p.pendingReason = "Every entry has a full exchange receipt.";
      return;
    }
    p.pendingReason = "Waiting for the strategy condition or a full predecessor receipt.";
    for (const s of w.stages) {
      let existing = orderFor(s.id),
        status = statusFor(s.id);
      if (status === "filled") continue;
      if (existing) {
        if (existing.ledger.orders[0].dispatched) {
          if (terminal(existing)) {
            p.status = "stopped";
            p.pendingReason = "A predecessor ended without a full fill.";
            return;
          }
          p.pendingReason = "Reconciling the existing order with the exchange.";
          return;
        }
        if (existing.terms.expiresAt <= this.d.now() && !terminal(existing)) {
          apply(existing, { kind: "revoke", id: existing.terms.id });
          delete p.stageOrders[s.id];
          existing = undefined;
        } else if (terminal(existing)) {
          p.status = "stopped";
          p.pendingReason = "An entry was revoked.";
          return;
        }
      }
      if (!eligible.has(s.id) || s.after.some((d) => statusFor(d.stageId) !== "filled")) continue;
      if (!existing) {
        const market = w.assets.find((a) => a.id === s.assetId)!;
        const t = await this.prepare(
          u,
          {
            symbol: executableSymbol(market)!,
            side: s.side as "long" | "short",
            marginUsd: s.amount.value!,
            leverage: s.leverage,
            slippageBps: 50,
          },
          p.id,
        );
        p.stageOrders[s.id] = t.id;
        existing = this.order(u, t.id);
        await this.d.commit();
      }
      if (p.mode === "auto") {
        await this.confirm(u, existing.terms.id, existing.terms.digest);
        p.pendingReason = "Waiting for the exchange fill receipt.";
      } else p.pendingReason = "Review the exact testnet order before it expires.";
      return;
    }
  }
  pause(u: User) {
    const a = this.record(u.id);
    a.paused = true;
    this.disable(u);
    return this.view(u);
  }
  resume(u: User) {
    this.record(u.id).paused = false;
    return this.view(u);
  }
  private checkAccount(u: User) {
    if (this.d.store.executionAccounts.get(u.id)?.paused)
      throw new HostError(409, "Resume this account before preparing orders.");
  }

  constructor(private d: Options) {}
  record(id: string) {
    let a = this.d.store.executionAccounts.get(id);
    if (!a) {
      a = { orders: [] };
      this.d.store.executionAccounts.set(id, a);
    }
    return a;
  }
  private needVenue() {
    if (!this.d.enabled() || !this.d.durable() || !this.d.vault.available)
      throw new HostError(
        503,
        "Testnet signing requires an enabled server, healthy durable storage and an encrypted signer.",
      );
  }
  async exclusive<T>(owner: string, op: () => Promise<T>) {
    if (this.busy.has(owner)) throw new HostError(409, "A wallet operation is in progress.");
    this.busy.add(owner);
    try {
      return await op();
    } finally {
      this.busy.delete(owner);
    }
  }
  view(u: User) {
    const a = this.d.store.executionAccounts.get(u.id),
      g = a?.agent;
    return {
      programs: (a?.programs ?? []).map((p) => ({
        id: p.id,
        strategyId: p.strategyId,
        version: p.version,
        name: p.strategy.name,
        mode: p.mode,
        status: p.status,
        detail: p.pendingReason,
      })),
      paused: a?.paused ?? false,
      testnetEnabled: this.d.enabled() && this.d.durable() && this.d.vault.available,
      mainnetEnabled: false,
      solanaWallets: u.solanaWallets ?? [],
      ethereumWallets: u.linkedWallets?.map((x) => x.address) ?? [],
      agent: g
        ? {
            agent: g.grant.agent,
            master: g.master,
            validUntil: g.grant.validUntil,
            state: g.grant.validUntil <= this.d.now() ? "expired" : g.state,
          }
        : null,
      orders: (a?.orders ?? [])
        .slice(-30)
        .reverse()
        .map((o) => ({
          terms: o.terms,
          status: o.ledger.orders[0].status,
          filledUnits: o.ledger.orders[0].filledQty,
          receiptCount: o.ledger.orders[0].executions.length,
          issues: o.ledger.issues,
          lastCheck: o.lastCheck,
        })),
      swaps: (a?.swaps ?? []).map((s) => ({
        id: s.pin.intent.intentId,
        inputMint: s.pin.intent.inputMint,
        outputMint: s.pin.intent.outputMint,
        expiresAt: s.pin.expiresAt,
        txid: s.txid ?? null,
        status: s.receipt?.status ?? (s.txid ? "awaiting_finality" : "quoted"),
      })),
    };
  }
  challenge(u: User, address: string) {
    if (!this.d.origin) throw new HostError(503, "The wallet origin is not configured.");
    const now = this.d.now(),
      c = {
        address,
        ownerId: u.id,
        origin: this.d.origin,
        nonce: randomBytes(24).toString("base64url"),
        issuedAt: now,
        expiresAt: now + 180000,
      };
    const message = ownershipMessage(c);
    this.record(u.id).challenge = c;
    return { nonce: c.nonce, message };
  }
  link(u: User, address: string, nonce: string, signature: string) {
    const a = this.record(u.id),
      c = a.challenge;
    if (
      !c ||
      !verifyLink(c, { ownerId: u.id, origin: this.d.origin ?? "", address, nonce }, signature, this.d.now())
    )
      throw new HostError(403, "The wallet signature does not match this challenge.");
    if ([...this.d.store.users.values()].some((v) => v.id !== u.id && v.solanaWallets?.includes(address)))
      throw new HostError(409, "This wallet is linked to another account.");
    const all = new Set([...(u.solanaWallets ?? []), address]);
    if (all.size > 5) throw new HostError(422, "Five Solana wallets are already linked.");
    delete a.challenge;
    u.solanaWallets = [...all];
    return this.view(u);
  }
  private aad(uid: string, address: string) {
    return uid + ":hyperliquid:testnet:" + address.toLowerCase();
  }
  grant(u: User, master: Address) {
    this.needVenue();
    this.checkAccount(u);
    if (!u.linkedWallets?.some((x) => x.address.toLowerCase() === master.toLowerCase()))
      throw new HostError(403, "Link the owner wallet before authorizing its agent.");
    const a = this.record(u.id),
      old = a.agent,
      now = this.d.now();
    if (
      [...this.d.store.executionAccounts.entries()].some(
        ([uid, x]) =>
          uid !== u.id &&
          x.agent &&
          x.agent.master.toLowerCase() === master.toLowerCase() &&
          x.agent.state !== "disabled" &&
          x.agent.grant.validUntil > now,
      )
    )
      throw new HostError(409, "This wallet already has a Quiver testnet grant.");
    if (
      old &&
      old.state !== "disabled" &&
      old.grant.validUntil > now &&
      (old.state !== "pending" || old.grant.nonce + 300000 > now)
    ) {
      if (old.master.toLowerCase() !== master.toLowerCase() || old.state !== "pending")
        throw new HostError(409, "Disable or reconcile the current agent first.");
      return { agent: old.grant.agent, typedData: walletApprovalPayload(old.grant) };
    }
    const key = generatePrivateKey(),
      agent = privateKeyToAccount(key).address,
      grant = { agent, name: "QuiverTest", nonce: now, validUntil: now + 86400000 };
    a.agent = {
      master,
      grant,
      sealed: this.d.vault.seal(key, this.aad(u.id, agent)),
      state: "pending",
      lastNonce: 0,
    };
    return { agent, typedData: walletApprovalPayload(grant) };
  }
  async activate(u: User, signature: Hex) {
    this.needVenue();
    const a = this.record(u.id).agent;
    if (!a || !["pending", "checking"].includes(a.state))
      throw new HostError(409, "Request a testnet grant first.");
    if (a.state === "pending") {
      a.state = "checking";
      await this.d.commit();
      await this.d.venue.approve(a.grant, signature, a.master);
    }
    if (!(await this.d.venue.activeGrant(a.grant, a.master)))
      throw new HostError(409, "The exchange has not confirmed this agent. Disable it to replace it.");
    a.state = "active";
    return this.view(u);
  }
  disable(u: User) {
    const a = this.record(u.id);
    for (const p of a.programs ?? []) if (p.status === "running") this.stopProgram(u, p.id);
    if (a.agent) {
      a.agent.sealed = "";
      a.agent.state = "disabled";
    }
    for (const o of a.orders)
      if (!o.ledger.orders[0].dispatched) apply(o, { kind: "revoke", id: o.terms.id });
    return this.view(u);
  }
  private agent(u: User) {
    this.needVenue();
    this.checkAccount(u);
    const a = this.record(u.id).agent;
    if (
      !a ||
      a.state !== "active" ||
      a.grant.validUntil <= this.d.now() ||
      !u.linkedWallets?.some((x) => x.address.toLowerCase() === a.master.toLowerCase())
    )
      throw new HostError(403, "An active grant from the linked wallet is required.");
    return a;
  }
  async balance(u: User) {
    const g = this.agent(u);
    return this.d.venue.account(g.master);
  }
  async prepare(u: User, b: z.infer<typeof OrderInput>, programId?: string) {
    const a = this.record(u.id),
      g = this.agent(u);
    if (a.programs?.some((p) => p.status === "running" && p.id !== programId))
      throw new HostError(
        409,
        "A testnet workflow controls this account. Stop it before using manual orders.",
      );
    for (const record of this.d.store.executionAccounts.values())
      for (const o of record.orders) {
        if (!o.ledger.orders[0].dispatched && !terminal(o) && o.terms.expiresAt <= this.d.now())
          apply(o, { kind: "revoke", id: o.terms.id });
        if (o.terms.owner.toLowerCase() === g.master.toLowerCase() && !terminal(o))
          throw new HostError(409, "Reconcile the existing testnet order before preparing another.");
      }
    const day = new Date(this.d.now()).toISOString().slice(0, 10);
    const used = a.orders.filter(
      (o) =>
        o.ledger.orders[0].dispatched &&
        new Date(o.terms.expiresAt - 30000).toISOString().slice(0, 10) === day,
    );
    if (used.length >= 10 || used.reduce((sum, o) => sum + o.terms.marginUsd, 0) + b.marginUsd > 500)
      throw new HostError(429, "Daily testnet limit reached (10 orders or 500 test USD of isolated margin).");
    if (a.orders.length >= 200)
      throw new HostError(429, "This account reached its testnet order retention limit.");
    const [market, quote, bal] = await Promise.all([
      this.d.venue.market(b.symbol),
      this.d.venue.bestPrice(b.symbol, b.side === "long"),
      this.d.venue.account(g.master, b.symbol),
    ]);
    updateLeverage(market, b.leverage, false);
    if (bal.occupied)
      throw new HostError(409, "This market already has an open order or position on the linked account.");
    const reserve = units(String(b.marginUsd)) + units(String(b.marginUsd * b.leverage)) / 100n;
    if (units(bal.withdrawable) < reserve)
      throw new HostError(422, "Insufficient available testnet collateral including the fee allowance.");
    const id = token(),
      cloid = "0x" + id,
      limit = iocLimit(quote, b.side === "long", b.slippageBps, market.szDecimals);
    const quantity = sizeFromNotional(
      String(b.marginUsd * b.leverage),
      b.side === "long" ? limit : quote,
      market.szDecimals,
    );
    perpOrder(market, b.side === "long", limit, quantity, false, cloid);
    const terms = {
      ...b,
      id,
      owner: g.master,
      market,
      quantity,
      limit,
      cloid,
      expiresAt: this.d.now() + 30000,
    };
    const digest = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
    const o: VenueOrder = {
      terms: { ...terms, digest },
      ledger: createLedger(id, [{ venue: "hl-testnet", asset: "USDC", units: reserve.toString() }]),
      lastCheck: 0,
    };
    apply(o, {
      kind: "plan",
      spec: {
        id,
        venue: "hl-testnet",
        instrument: b.symbol,
        side: b.side,
        targetQty: units(quantity).toString(),
        termsHash: digest,
        reserve: [{ asset: "USDC", units: reserve.toString() }],
        after: [],
      },
    });
    a.orders.push(o);
    return o.terms;
  }
  private order(u: User, id: string) {
    const o = this.record(u.id).orders.find((x) => x.terms.id === id);
    if (!o) throw new HostError(404, "Order not found.");
    return o;
  }
  private async signed(u: User, g: Agent, action: L1Action) {
    const a = this.agent(u),
      key = this.d.vault.open(a.sealed, this.aad(u.id, g.grant.agent));
    if (a !== g || !key) throw new HostError(403, "The local signer is disabled.");
    const nonce = Math.max(this.d.now(), g.lastNonce + 1);
    g.lastNonce = nonce;
    await this.d.commit();
    const signed = await signTestnet(action, nonce, nonce + 12000, (data) =>
      privateKeyToAccount(key as Hex).signTypedData(data),
    );
    if (this.agent(u) !== g) throw new HostError(409, "The grant changed.");
    return this.d.venue.submit(signed, g.grant.agent);
  }
  async confirm(u: User, id: string, digest: string) {
    const o = this.order(u, id),
      t = o.terms,
      g = this.agent(u);
    if (o.ledger.orders[0].dispatched) return this.reconcile(u, id);
    const program = this.record(u.id).programs?.find((p) => Object.values(p.stageOrders).includes(id));
    if (program) {
      if (program.status !== "running") throw new HostError(409, "The workflow is stopped.");
      await this.lossGuard(u, program);
    }

    if (
      t.digest !== digest ||
      t.expiresAt <= this.d.now() ||
      g.master.toLowerCase() !== t.owner.toLowerCase()
    )
      throw new HostError(409, "These order terms expired or changed.");
    const [active, bal, market] = await Promise.all([
      this.d.venue.activeGrant(g.grant, g.master),
      this.d.venue.account(g.master, t.symbol),
      this.d.venue.market(t.symbol),
    ]);
    if (
      !active ||
      bal.occupied ||
      units(bal.withdrawable) < BigInt(o.ledger.genesis[0].units) ||
      market.asset !== t.market.asset ||
      market.szDecimals !== t.market.szDecimals
    )
      throw new HostError(409, "Testnet permissions, available funds or market metadata changed.");
    apply(o, { kind: "approve", id, approvalRef: t.digest, expiresAt: t.expiresAt, now: this.d.now() });
    if (!apply(o, { kind: "submit", id, now: this.d.now() })) return this.view(u);
    await this.d.commit(); // Never broadcast from an in-memory reservation.
    try {
      await this.signed(u, g, updateLeverage(market, t.leverage, false));
      if (this.d.now() >= t.expiresAt) throw Error("Expired");
      const result = await this.signed(
        u,
        g,
        perpOrder(market, t.side === "long", t.limit, t.quantity, false, t.cloid),
      );
      if ("oid" in result) apply(o, { kind: "accepted", id, orderRef: String(result.oid) });
    } catch {
      apply(o, { kind: "unknown", id });
    }
    await this.d.commit();
    return this.reconcile(u, id);
  }
  async reconcile(u: User, id: string) {
    const o = this.order(u, id),
      t = o.terms;
    if (!o.ledger.orders[0].dispatched || terminal(o)) return this.view(u);
    const r = await this.d.venue.reconcile(
      t.owner,
      t.cloid,
      t.symbol,
      t.side === "long" ? "B" : "A",
      t.quantity,
    );
    o.lastCheck = this.d.now();
    if (!("receipts" in r) || !r.receipts) return this.view(u);
    const orderRef = String(r.oid);
    for (const f of r.receipts) {
      const qty = units(f.sz),
        fee = units(f.fee);
      // Settle confirmed initial margin and signed fee/rebate separately; the venue remains the balance authority.
      if (f.feeToken !== "USDC")
        throw new HostError(409, "Unexpected fee currency. Manual reconciliation is required.");
      const margin = ((qty * units(f.px)) / scale + BigInt(t.leverage) - 1n) / BigInt(t.leverage);
      const amounts = (v: bigint) => (v ? [{ asset: "USDC", units: v.toString() }] : []);
      apply(o, {
        kind: "execution",
        id,
        fill: {
          fillId: String(f.time) + ":" + f.tid,
          orderRef,
          qty: qty.toString(),
          debits: amounts(margin + (fee > 0n ? fee : 0n)),
          credits: amounts(fee < 0n ? -fee : 0n),
        },
      });
    }
    const order = o.ledger.orders[0];
    if (r.complete || ["partial_canceled", "canceled", "rejected"].includes(r.status))
      apply(o, {
        kind: "final",
        id,
        report: {
          orderRef,
          outcome: r.complete ? "filled" : r.status === "rejected" ? "rejected" : "cancelled",
          cumulativeQty: units(r.filledSize!).toString(),
          cumulativeDebits: order.debits,
          cumulativeCredits: order.credits,
        },
      });
    return this.view(u);
  }
  async cancel(u: User, id: string) {
    const o = this.order(u, id),
      g = this.agent(u);
    if (g.master.toLowerCase() !== o.terms.owner.toLowerCase())
      throw new HostError(403, "Different account.");
    if (!o.ledger.orders[0].dispatched) {
      apply(o, { kind: "revoke", id });
      return this.view(u);
    }
    if (!terminal(o) && !o.cancelRequested) {
      o.cancelRequested = true;
      await this.d.commit();
      await this.signed(u, g, cancelByCloid(o.terms.market, o.terms.cloid));
    }
    return this.reconcile(u, id);
  }
}
