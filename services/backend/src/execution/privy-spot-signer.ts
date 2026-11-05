import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
  randomBytes,
} from "node:crypto";
import {
  makeFundingBundle,
  fundingRevoke,
  bindSetup,
  broadcastExact,
  SOLANA_GENESIS,
  CPMM,
  CP_IDL,
  validateScope,
  verifyAllowance,
  verifyUnsigned,
  verifySigned,
  type SwapScope,
  type DirectPin,
  amount,
} from "./raydium-scoped-swap";
import { read58 } from "./solana-wire";
const ROOT = "https://api.privy.io";
type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
type Obj = Record<string, any>;
type Rpc = Parameters<typeof verifyAllowance>[1];
type Vault = {
  available: boolean;
  seal(raw: string, aad: string): string;
  open(cipher: string, aad: string): string | null;
};
function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
const id = (value: string) => {
  ok(
    typeof value === "string" && /^[a-zA-Z0-9_-]{3,112}$/.test(value),
    "Invalid Privy resource identity.",
  );
  return value;
};
const vaultContext = (key: string, uid: string, wd: string) =>
  "quiver:privy:auto-sol-mainnet:v1:" + uid + ":" + wd + ":" + key;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
function canonical(v: Json): string {
  if (v === null || typeof v === "boolean" || typeof v === "string")
    return JSON.stringify(v);
  if (typeof v === "number") {
    ok(Number.isFinite(v), "Non-finite number in signature payload.");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}
function cond(
  source: string,
  field: string,
  operator: string,
  value: string,
  idl = false,
) {
  return {
    field_source: source,
    field,
    operator,
    value,
    ...(idl ? { idl: CP_IDL } : {}),
  };
}
export function delegationPolicy(scopes: SwapScope[]) {
  const path = "swap_base_input.";
  return {
    version: "1.0",
    name: "Quiver bounded Raydium swap",
    chain_type: "solana",
    rules: scopes.map((s, i) => ({
      name: "Approved pair " + (i + 1),
      method: "signTransaction",
      action: "ALLOW",
      conditions: [
        cond(
          "system",
          "current_unix_timestamp",
          "lt",
          String(Math.floor(s.expiresAt / 1000)),
        ),
        cond("solana_program_instruction", "programId", "eq", CPMM),
        cond(
          "solana_instruction_data",
          "instruction_name",
          "eq",
          "swap_base_input",
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "accounts.payer",
          "eq",
          s.executor,
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "accounts.pool_state",
          "eq",
          s.pool,
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "accounts.input_token_account",
          "eq",
          s.inputAccount,
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "accounts.output_token_account",
          "eq",
          s.outputAccount,
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "args.amount_in",
          "eq",
          s.unitsPerOrder,
          true,
        ),
        cond(
          "solana_instruction_data",
          path + "args.minimum_amount_out",
          "gte",
          s.minimumOutputUnits,
          true,
        ),
      ],
    })),
  };
}
export type WalletIdentity = { ownerId: string; did: string; walletId: string };
type SignOperation = {
  id: string;
  messageHash: string;
  reserve: string;
  txid?: string;
};
type Setup = {
  kind: "approve" | "revoke";
  id: string;
  unsigned: string;
  expiresAtBlock: number;
  estimatedFeeLamports?: string;
  estimatedRentLamports?: string;
  txid?: string;
  state: "ready" | "attempted" | "finalized" | "failed" | "expired";
};
export type PrivySpotGrant = {
  id: string;
  ownerId: string;
  did: string;
  walletId: string;
  walletOwner: string;
  strategyId: string;
  version: number;
  programId?: string;
  stages: { stageId: string; scope: SwapScope }[];
  signerPublicKey: string;
  sealed: string;
  signerId: string;
  policyId: string;
  status: "offered" | "active" | "disabled";
  ops: SignOperation[];
  setups?: Setup[];
  revision: number;
};
export interface PrivySpotStore {
  read(id: string): PrivySpotGrant | undefined;
  create(g: PrivySpotGrant): Promise<void>;
  save(g: PrivySpotGrant, expectedRevision: number): Promise<void>;
}
type Options = {
  appId: string;
  appSecret: string;
  vault: Vault;
  store: PrivySpotStore;
  rpc: Rpc;
  verifiedFunding?: (
    ownerId: string,
    address: string,
  ) => boolean | Promise<boolean>;
  now?: () => number;
  fetch?: typeof fetch;
};
type OwnerGrant = { g: PrivySpotGrant; ownerId: string };
export class PrivySpotSigner {
  private inFlight = new Set<string>();
  private fetch: typeof fetch;
  private now: () => number;
  constructor(private opts: Options) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }
  private async call(
    method: "GET" | "POST",
    path: string,
    body?: Obj,
    auth?: { privateKey: string; idempotency: string },
  ) {
    const url = ROOT + path,
      headers: Record<string, string> = {
        "content-type": "application/json",
        "privy-app-id": this.opts.appId,
        authorization:
          "Basic " +
          Buffer.from(this.opts.appId + ":" + this.opts.appSecret).toString(
            "base64",
          ),
      };
    if (auth) {
      const signedHeaders = {
        "privy-app-id": this.opts.appId,
        "privy-request-expiry": String(this.now() + 30_000),
        "privy-idempotency-key": auth.idempotency,
      };
      const input = {
        version: 1,
        method,
        url,
        body: body as Json,
        headers: signedHeaders,
      };
      const key = createPrivateKey({
        key: Buffer.from(auth.privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      });
      Object.assign(headers, signedHeaders, {
        "privy-authorization-signature": sign(
          "sha256",
          Buffer.from(canonical(input)),
          key,
        ).toString("base64"),
      });
    }
    const res = await this.fetch(url, {
      method,
      redirect: "error",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok)
      throw Error(
        "Privy could not verify the requested wallet action (" +
          res.status +
          ").",
      );
    const str = await res.text();
    ok(str.length <= 512_000, "Privy evidence too large.");
    return JSON.parse(str) as Obj;
  }
  private async wallet(
    user: WalletIdentity,
    address: string,
    fundingOwner: string,
  ) {
    ok(
      /^did:privy:[A-Za-z0-9_-]{6,64}$/.test(user.did) && !!user.ownerId,
      "A verified Privy account is required.",
    );
    const [u, w] = await Promise.all([
      this.call("GET", "/v1/users/" + encodeURIComponent(user.did)),
      this.call("GET", "/v1/wallets/" + id(user.walletId)),
    ]);
    ok(
      u.id === user.did &&
        Array.isArray(u.linked_accounts) &&
        u.linked_accounts.some(
          (a: Obj) =>
            a.id === user.walletId &&
            a.address === address &&
            a.chain_type === "solana" &&
            a.type === "wallet" &&
            a.wallet_client_type === "privy" &&
            a.connector_type === "embedded" &&
            a.user_can_sign === true,
        ),
      "The execution wallet must be a Privy embedded wallet of this user.",
    );
    ok(
      (await this.opts.verifiedFunding?.(user.ownerId, fundingOwner)) ||
        u.linked_accounts.some(
          (a: Obj) =>
            a.address === fundingOwner &&
            a.type === "wallet" &&
            a.chain_type === "solana",
        ),
      "Link the funding wallet to the same Privy account.",
    );
    ok(
      w.id === user.walletId &&
        w.chain_type === "solana" &&
        w.address === address &&
        w.archived_at == null &&
        typeof w.owner_id === "string" &&
        Array.isArray(w.additional_signers) &&
        Array.isArray(w.policy_ids),
      "Unrecognized or unavailable Privy wallet.",
    );
    if (w.owner_id !== user.did) {
      const q = await this.call("GET", "/v1/key_quorums/" + id(w.owner_id));
      ok(
        q.id === w.owner_id &&
          q.authorization_threshold === 1 &&
          Array.isArray(q.user_ids) &&
          q.user_ids.length === 1 &&
          q.user_ids[0] === user.did &&
          Array.isArray(q.authorization_keys) &&
          !q.authorization_keys.length &&
          !q.key_quorum_ids?.length,
        "Only a user-controlled execution wallet is eligible.",
      );
    }
    return w;
  }
  private own(ownerId: string, grantId: string) {
    const g = this.opts.store.read(id(grantId));
    ok(g && g.ownerId === ownerId, "Grant not found.");
    return g;
  }
  private async checkProvider(g: PrivySpotGrant, active: boolean) {
    const s = g.stages[0].scope;
    const [w, q, p] = await Promise.all([
      this.wallet(g, s.executor, s.fundingOwner),
      this.call("GET", "/v1/key_quorums/" + id(g.signerId)),
      this.call("GET", "/v1/policies/" + id(g.policyId)),
    ]);
    ok(
      w.owner_id === g.walletOwner &&
        q.id === g.signerId &&
        q.authorization_threshold === 1 &&
        q.authorization_keys?.length === 1 &&
        q.authorization_keys[0].public_key === g.signerPublicKey &&
        !q.user_ids?.length &&
        !q.key_quorum_ids?.length,
      "The signer quorum or wallet owner changed.",
    );
    ok(
      p.id === g.policyId &&
        p.owner_id === g.walletOwner &&
        p.version === "1.0" &&
        p.chain_type === "solana" &&
        Array.isArray(p.rules),
      "Policy ownership or chain changed.",
    );
    const wanted = delegationPolicy(g.stages.map((v) => v.scope));
    // GET includes generated rule IDs. The order of ANDed conditions is not material.
    const norm = (rules: Obj[]) =>
      rules
        .map((r) => ({
          method: r.method,
          action: r.action,
          conditions: (r.conditions ?? [])
            .map((c: Obj) => canonical(c as Json))
            .sort(),
        }))
        .sort((a, b) => canonical(a).localeCompare(canonical(b)));
    ok(
      canonical(norm(p.rules)) === canonical(norm(wanted.rules)),
      "Signer policy differs from the immutable scoped grant.",
    );
    ok(w.policy_ids.length === 0, "Wallet policies changed.");
    if (active) {
      const s = w.additional_signers;
      ok(
        s.length === 1 &&
          s[0].signer_id === g.signerId &&
          s[0].override_policy_ids?.length === 1 &&
          s[0].override_policy_ids[0] === g.policyId,
        "Owner consent is absent, overridden or shared with another signer.",
      );
    }
    return w;
  }
  async offer(
    user: WalletIdentity,
    policy: {
      strategyId: string;
      version: number;
      stages: { stageId: string; scope: SwapScope }[];
    },
  ) {
    const { strategyId, version, stages } = policy;
    id(strategyId);
    ok(
      Number.isInteger(version) &&
        version > 0 &&
        stages.length > 0 &&
        stages.length <= 8 &&
        new Set(stages.map((x) => x.stageId)).size === stages.length,
      "Invalid strategy scope.",
    );
    const scope = stages[0].scope;
    for (const entry of stages) {
      id(entry.stageId);
      validateScope(entry.scope, this.now());
      const x = entry.scope;
      ok(
        x.executor === scope.executor &&
          x.fundingOwner === scope.fundingOwner &&
          x.inputMint === scope.inputMint &&
          x.inputAccount === scope.inputAccount &&
          x.totalInputUnits === scope.totalInputUnits &&
          x.expiresAt === scope.expiresAt &&
          x.feeCapLamports === scope.feeCapLamports,
        "All legs must share the same bounded funding allowance and expiry.",
      );
    }
    ok(
      this.opts.vault.available && this.opts.appId && this.opts.appSecret,
      "Verified Privy and encrypted storage are required.",
    );
    validateScope(scope, this.now());
    const w = await this.wallet(user, scope.executor, scope.fundingOwner);
    ok(
      w.additional_signers.length === 0 && w.policy_ids.length === 0,
      "Use a dedicated execution wallet without other signers or wallet policies.",
    );
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
      pub = key.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64");
    const grantId = randomBytes(16).toString("hex"),
      sealed = this.opts.vault.seal(
        key.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64"),
        vaultContext(grantId, user.ownerId, user.walletId),
      );
    const q = await this.call("POST", "/v1/key_quorums", {
      display_name: "Quiver spot " + grantId.slice(0, 10),
      authorization_threshold: 1,
      public_keys: [pub],
    });
    const p = await this.call("POST", "/v1/policies", {
      ...delegationPolicy(stages.map((v) => v.scope)),
      owner_id: w.owner_id,
    });
    const g: PrivySpotGrant = {
      ...user,
      id: grantId,
      walletOwner: w.owner_id,
      strategyId,
      version,
      stages: structuredClone(stages),
      sealed,
      signerPublicKey: pub,
      signerId: id(q.id),
      policyId: id(p.id),
      ops: [],
      status: "offered",
      revision: 0,
    };
    await this.checkProvider(g, false);
    await this.opts.store.create(g);
    return {
      id: g.id,
      address: scope.executor,
      signers: [{ signerId: g.signerId, policyIds: [g.policyId] }],
      stages: structuredClone(stages),
    };
  }
  publicView(g: PrivySpotGrant) {
    const first = g.stages[0].scope;
    return {
      id: g.id,
      strategyId: g.strategyId,
      version: g.version,
      walletId: g.walletId,
      executor: first.executor,
      fundingOwner: first.fundingOwner,
      status:
        first.expiresAt <= this.now() && g.status !== "disabled"
          ? "expired"
          : g.status,
      signerId: g.signerId,
      policyId: g.policyId,
      stages: g.stages.map((r) => ({ stageId: r.stageId, ...r.scope })),
      reserved: g.ops.reduce((n, x) => n + amount(x.reserve), 0n).toString(),
      setup: g.setups?.at(-1)
        ? {
            id: g.setups.at(-1)!.id,
            kind: g.setups.at(-1)!.kind,
            state: g.setups.at(-1)!.state,
            txid: g.setups.at(-1)!.txid,
          }
        : null,
    };
  }
  async prepareSetup(
    ownerId: string,
    grantId: string,
    kind: "approve" | "revoke",
  ) {
    const g = this.own(ownerId, grantId),
      s = g.stages[0].scope;
    ok(
      kind === "approve"
        ? g.status === "offered" && s.expiresAt > this.now()
        : g.status === "disabled",
      "Unexpected grant phase.",
    );
    const prior = g.setups?.at(-1);
    if (
      prior &&
      prior.kind === kind &&
      !["failed", "expired"].includes(prior.state)
    ) {
      if (prior.state === "ready") {
        const height = await this.opts.rpc<number>("getBlockHeight", [
          { commitment: "confirmed" },
        ]);
        if (height <= prior.expiresAtBlock)
          return {
            kind,
            id: prior.id,
            unsigned: prior.unsigned,
            expiresAtBlock: prior.expiresAtBlock,
            estimatedFeeLamports: prior.estimatedFeeLamports,
            estimatedRentLamports: prior.estimatedRentLamports,
          };
      } else
        return { kind, id: prior.id, state: prior.state, txid: prior.txid };
    }
    if (kind === "approve") await this.checkProvider(g, true);
    const built: {
      unsigned: string;
      expiresAtBlock: number;
      estimatedFeeLamports?: string;
      estimatedRentLamports?: string;
    } =
      kind === "approve"
        ? await makeFundingBundle(
            g.stages.map((x) => x.scope),
            this.opts.rpc,
            this.now(),
          )
        : await fundingRevoke(s, this.opts.rpc);
    const entry: Setup = {
      kind,
      id: randomBytes(14).toString("hex"),
      unsigned: built.unsigned,
      expiresAtBlock: built.expiresAtBlock,
      ...("estimatedFeeLamports" in built
        ? {
            estimatedFeeLamports: built.estimatedFeeLamports as string,
            estimatedRentLamports: built.estimatedRentLamports as string,
          }
        : {}),
      state: "ready",
    };
    const old = g.setups ?? [];
    ok(old.length < 25, "Setup history limit exceeded.");
    await this.opts.store.save(
      { ...g, revision: g.revision + 1, setups: [...old, entry] },
      g.revision,
    );
    return {
      kind,
      id: entry.id,
      unsigned: built.unsigned,
      expiresAtBlock: built.expiresAtBlock,
      estimatedFeeLamports: entry.estimatedFeeLamports,
      estimatedRentLamports: entry.estimatedRentLamports,
    };
  }
  async submitSetup(
    ownerId: string,
    grantId: string,
    setupId: string,
    wire: string,
  ) {
    const g = this.own(ownerId, grantId),
      s = g.stages[0].scope,
      row = g.setups?.find((x) => x.id === id(setupId));
    ok(
      row &&
        g.setups?.at(-1) === row &&
        (row.kind === "revoke"
          ? g.status === "disabled"
          : g.status === "offered" && this.now() < s.expiresAt),
      "Unknown or stale setup request.",
    );
    const txid = bindSetup(row.unsigned, wire, s.fundingOwner);
    if (row.txid) {
      ok(row.txid === txid, "Conflicting setup signature.");
      return this.checkSetup(ownerId, grantId, setupId);
    }
    ok(
      row.state === "ready" &&
        (await this.opts.rpc("getGenesisHash", [])) === SOLANA_GENESIS &&
        (await this.opts.rpc<number>("getBlockHeight", [
          { commitment: "confirmed" },
        ])) <= row.expiresAtBlock,
      "Setup expired.",
    );
    const simulation = await this.opts.rpc<{ value: { err: unknown } }>(
      "simulateTransaction",
      [
        wire,
        {
          sigVerify: true,
          encoding: "base64",
          commitment: "confirmed",
          replaceRecentBlockhash: false,
        },
      ],
    );
    ok(
      simulation.value.err === null,
      "The funding-wallet transaction failed simulation. Check its SOL fee balance and token accounts.",
    );
    await this.opts.store.save(
      {
        ...g,
        revision: g.revision + 1,
        setups: g.setups!.map((x) =>
          x.id === setupId ? { ...x, txid, state: "attempted" } : x,
        ),
      },
      g.revision,
    );
    const latest = this.own(ownerId, grantId);
    if (latest.status !== g.status)
      throw Error("Grant state changed before wallet submission.");
    try {
      await broadcastExact(this.opts.rpc, wire, txid);
    } catch {
      /* uncertain, reconcile the original signature without retransmitting */
    }
    return this.checkSetup(ownerId, grantId, setupId);
  }
  async checkSetup(ownerId: string, grantId: string, setupId: string) {
    const g = this.own(ownerId, grantId),
      row = g.setups?.find((x) => x.id === id(setupId));
    ok(row, "Unknown setup request.");
    if (row.state === "attempted" && row.txid) {
      const rpc = this.opts.rpc;
      ok(
        (await rpc("getGenesisHash", [])) === SOLANA_GENESIS,
        "Wrong Solana network.",
      );
      const status = await rpc<{
        value: ({
          err: unknown;
          confirmationStatus: string;
          slot: number;
        } | null)[];
      }>("getSignatureStatuses", [
        [row.txid],
        { searchTransactionHistory: true },
      ]);
      let state: Setup["state"] | null = null;
      const s = status.value[0];
      if (s?.confirmationStatus === "finalized" && s.err !== undefined) {
        const tx = await rpc<{
          slot: number;
          transaction: [string, string];
          meta: { err: unknown };
        } | null>("getTransaction", [
          row.txid,
          {
            commitment: "finalized",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (
          tx &&
          tx.slot === s.slot &&
          tx.transaction[1] === "base64" &&
          bindSetup(
            row.unsigned,
            tx.transaction[0],
            g.stages[0].scope.fundingOwner,
          ) === row.txid &&
          (s.err === null) === (tx.meta.err === null)
        )
          state = s.err === null ? "finalized" : "failed";
      } else if (
        !s &&
        (await rpc<number>("getBlockHeight", [{ commitment: "finalized" }])) >
          row.expiresAtBlock
      ) {
        // When historical RPC lookup is inconclusive keep the original intent. A second approval would reset the on-chain allowance.
        state = null;
      }
      if (state) {
        await this.opts.store.save(
          {
            ...g,
            revision: g.revision + 1,
            setups: g.setups!.map((x) =>
              x.id === row.id ? { ...x, state } : x,
            ),
          },
          g.revision,
        );
        return { id: row.id, kind: row.kind, txid: row.txid, state };
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      txid: row.txid ?? null,
      state: row.state,
    };
  }
  async soleProviderSigner(ownerId: string, grantId: string) {
    const g = this.own(ownerId, grantId),
      s = g.stages[0].scope,
      w = await this.wallet(g, s.executor, s.fundingOwner);
    return {
      executor: s.executor,
      removeAllSafe:
        w.additional_signers.length === 1 &&
        w.additional_signers[0].signer_id === g.signerId,
    };
  }
  async activate(ownerId: string, grantId: string) {
    const g = this.own(ownerId, grantId);
    ok(
      g.status === "offered" && g.stages[0].scope.expiresAt > this.now(),
      "Grant is expired or disabled.",
    );
    ok(
      g.setups?.some((v) => v.kind === "approve" && v.state === "finalized"),
      "The owner-approved SPL funding transaction is not finalized.",
    );
    await Promise.all([
      this.checkProvider(g, true),
      ...g.stages.map((s) => verifyAllowance(s.scope, this.opts.rpc, true)),
    ]);
    await this.opts.store.save(
      { ...g, status: "active", revision: g.revision + 1 },
      g.revision,
    );
  }
  async disable(ownerId: string, grantId: string) {
    const g = this.own(ownerId, grantId);
    if (g.status !== "disabled")
      await this.opts.store.save(
        { ...g, status: "disabled", sealed: "", revision: g.revision + 1 },
        g.revision,
      );
  }
  /** Never accepts browser-supplied transaction bytes. The live coordinator loads its server-generated pin by immutable intent ID. */
  async signPinned(
    ownerId: string,
    grantId: string,
    intentId: string,
    pin: DirectPin,
    terms: {
      strategyId: string;
      version: number;
      stageId: string;
      programId: string;
    },
  ) {
    id(intentId);
    ok(!this.inFlight.has(grantId), "Signing is in progress.");
    this.inFlight.add(grantId);
    try {
      let g = this.own(ownerId, grantId);
      const scope = g.stages.find((s) => s.stageId === terms.stageId)?.scope;
      ok(
        (!g.programId || g.programId === terms.programId) &&
          g.strategyId === terms.strategyId &&
          g.version === terms.version &&
          scope &&
          g.status === "active" &&
          scope.expiresAt > this.now() &&
          canonical(scope as unknown as Json) ===
            canonical(pin.scope as unknown as Json),
        "Scope or grant state changed.",
      );
      await Promise.all([
        this.checkProvider(g, true),
        verifyUnsigned(pin, this.opts.rpc, this.now()),
      ]);
      let op = g.ops.find((x) => x.id === intentId);
      if (op)
        ok(
          op.messageHash === pin.digest,
          "An intent cannot authorize replacement bytes.",
        );
      else {
        ok(
          g.ops.length < 128 &&
            g.ops.reduce((n, o) => n + amount(o.reserve), 0n) +
              amount(scope.unitsPerOrder) <=
              amount(scope.totalInputUnits),
          "The grant has no remaining budget.",
        );
        op = {
          id: intentId,
          messageHash: pin.digest,
          reserve: scope.unitsPerOrder,
        };
        const updated = {
          ...g,
          programId: terms.programId,
          ops: [...g.ops, op],
          revision: g.revision + 1,
        };
        await this.opts.store.save(updated, g.revision);
        g = updated;
      }
      const current = this.own(ownerId, grantId);
      ok(
        current.status === "active" &&
          current.revision === g.revision &&
          current.stages[0].scope.expiresAt > this.now(),
        "Signer was paused or revoked.",
      );
      const key = this.opts.vault.open(
        current.sealed,
        vaultContext(g.id, g.ownerId, g.walletId),
      );
      ok(key, "Encrypted authorization key unavailable.");
      const pub = createPublicKey(
        createPrivateKey({
          key: Buffer.from(key, "base64"),
          format: "der",
          type: "pkcs8",
        }),
      )
        .export({ format: "der", type: "spki" })
        .toString("base64");
      ok(pub === g.signerPublicKey, "Signing key binding failed.");
      const body = {
        method: "signTransaction",
        chain_type: "solana",
        params: { transaction: pin.unsigned, encoding: "base64" },
      };
      const result = await this.call(
        "POST",
        "/v1/wallets/" + id(g.walletId) + "/rpc",
        body,
        {
          privateKey: key,
          idempotency: "qs-" + digest(g.id + ":" + intentId + ":" + pin.digest),
        },
      );
      ok(
        result.method === "signTransaction" &&
          result.data?.encoding === "base64" &&
          typeof result.data.signed_transaction === "string",
        "Invalid Privy signing response.",
      );
      const wire = result.data.signed_transaction,
        verified = await verifySigned(pin, this.opts.rpc, wire, this.now());
      g = this.own(ownerId, grantId);
      ok(
        g.status === "active" && g.stages[0].scope.expiresAt > this.now(),
        "Grant revoked during signing.",
      );
      const seen = g.ops.find((x) => x.id === intentId);
      ok(
        seen &&
          seen.messageHash === pin.digest &&
          (!seen.txid || seen.txid === verified.txid),
        "Conflicting signed receipt.",
      );
      if (!seen.txid)
        await this.opts.store.save(
          {
            ...g,
            ops: g.ops.map((o) =>
              o.id === intentId ? { ...o, txid: verified.txid } : o,
            ),
            revision: g.revision + 1,
          },
          g.revision,
        );
      return { wire, txid: verified.txid, simulated: verified.actual };
    } finally {
      this.inFlight.delete(grantId);
    }
  }
}
