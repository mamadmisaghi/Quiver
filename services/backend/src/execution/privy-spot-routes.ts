import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
type User = { id: string; label: string; solanaWallets?: string[] };
import type { Strategy } from "../../contracts/src/strategy";
import type { Driver } from "./live-program";
import type { SecretVault } from "../secrets/vault";
import {
  PrivySpotSigner,
  type PrivySpotGrant,
  type PrivySpotStore,
} from "./privy-spot-signer";
import { withPrivySpot, SPOT_USDC } from "./privy-spot-driver";
import {
  associated,
  discoverDirectPool,
  solanaRpc,
  type SwapScope,
  amount,
  validateScope,
} from "./raydium-scoped-swap";
type Env = { Variables: { user: User; requestId: string } };
type Mark = { usd: number; decimals: number };
export function privySpotStore(
  records: Map<string, PrivySpotGrant>,
  commit: () => Promise<void>,
  healthy: () => boolean,
): PrivySpotStore {
  const writable = () => {
    if (!healthy()) throw Error("Durable storage must be healthy.");
  };
  return {
    read(id) {
      const r = records.get(id);
      return r ? structuredClone(r) : undefined;
    },
    async create(g) {
      writable();
      if (
        records.has(g.id) ||
        [...records.values()].some(
          (v) =>
            v.status !== "disabled" &&
            v.stages[0].scope.expiresAt > Date.now() &&
            (v.walletId === g.walletId ||
              v.stages[0].scope.inputAccount ===
                g.stages[0].scope.inputAccount),
        )
      )
        throw Error("Disable the current permission first.");
      records.set(g.id, structuredClone(g));
      await commit();
    },
    async save(g, prior) {
      writable();
      const old = records.get(g.id);
      if (
        !old ||
        g.revision !== prior + 1 ||
        old.ownerId !== g.ownerId ||
        old.revision !== prior
      )
        throw Error("Permission changed; reload before continuing.");
      records.set(g.id, structuredClone(g));
      await commit();
    },
  };
}
type Options = {
  appId?: string;
  secret?: string;
  vault: SecretVault;
  records: Map<string, PrivySpotGrant>;
  commit: () => Promise<void>;
  healthy: () => boolean;
  enabled: () => boolean;
  rpcUrl?: string;
  linked: (uid: string, address: string) => boolean | Promise<boolean>;
  marks: (mints: string[]) => Promise<Record<string, Mark>>;
  strategy: (
    ownerId: string,
    id: string,
    version: number,
  ) => Promise<Strategy> | Strategy;
  mode: (
    ownerId: string,
    programId: string,
  ) => Promise<"auto" | "confirm_each">;
  fetch?: typeof fetch;
  now?: () => number;
};
type GrantPlan = {
  strategyId: string;
  version: number;
  stages: { stageId: string; scope: SwapScope }[];
};
const key = z.string().regex(/^[A-Za-z0-9:_-]{2,120}$/),
  address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const proposal = z
  .object({
    strategyId: key,
    version: z.number().int().positive(),
    walletId: key,
    executor: address,
    fundingOwner: address,
    stages: z.array(key).min(1).max(8),
    slippageBps: z.number().int().min(1).max(100),
    durationMinutes: z.number().int().min(5).max(1440),
    maxOrders: z.number().int().min(1).max(128),
  })
  .strict();
const did = (u: User) => {
  if (!/^privy:did:privy:[a-zA-Z0-9_-]{6,64}$/.test(u.label))
    throw Error("Sign in with Privy to authorize an embedded wallet.");
  return u.label.slice("privy:".length);
};
function opt(c: unknown, msg: string): asserts c {
  if (!c) throw Error(msg);
}
async function body<T extends z.ZodType>(
  c: Context<Env>,
  schema: T,
): Promise<z.output<T>> {
  const p = schema.safeParse(await c.req.json().catch(() => null));
  if (!p.success)
    throw Error("Choose a wallet, a strategy version and valid limits.");
  return p.data;
}
const usd6 = (n: number) => {
  opt(Number.isFinite(n) && n > 0 && n <= 1e9, "Unsupported fixed USD size.");
  const s = String(n).split(".");
  opt(
    /^\d+$/.test(s[0]) && (!s[1] || /^\d{1,6}$/.test(s[1])),
    "USDC allows at most six decimals.",
  );
  return BigInt(s[0]) * 1000000n + BigInt((s[1] ?? "").padEnd(6, "0"));
};
const ratio = (units: bigint, input: Mark, output: Mark) => {
  const price = (m: Mark) => {
    opt(
      m.usd > 0 &&
        m.usd < 1e12 &&
        Number.isFinite(m.usd) &&
        Number.isInteger(m.decimals) &&
        m.decimals >= 0 &&
        m.decimals <= 18,
      "Independent market quote unavailable.",
    );
    const n = BigInt(m.usd.toFixed(12).replace(".", ""));
    opt(n > 0n, "Price below supported precision.");
    return n;
  };
  return (
    (units * price(input) * 10n ** BigInt(output.decimals)) /
    (price(output) * 10n ** BigInt(input.decimals))
  );
};
export function privySpotFeature(o: Options) {
  const now = o.now ?? Date.now,
    rpc = solanaRpc(o.rpcUrl, o.fetch),
    all = (uid: string) =>
      [...o.records.values()].filter((x) => x.ownerId === uid);
  const store = privySpotStore(o.records, o.commit, o.healthy),
    signer = new PrivySpotSigner({
      appId: o.appId ?? "",
      appSecret: o.secret ?? "",
      vault: o.vault,
      store,
      rpc,
      fetch: o.fetch,
      now,
      verifiedFunding: o.linked,
    });
  const review = new Map<
    string,
    {
      owner: string;
      did: string;
      walletId: string;
      plan: GrantPlan;
      expires: number;
    }
  >();
  const r = new Hono<Env>(),
    locks = new Set<string>();
  const exclusive = async <T>(uid: string, fn: () => Promise<T>) => {
    if (locks.has(uid)) throw Error("A wallet permission is being updated.");
    locks.add(uid);
    try {
      return await fn();
    } finally {
      locks.delete(uid);
    }
  };
  const requireActive = () =>
    opt(
      o.enabled() && o.healthy() && o.vault.available && o.appId && o.secret,
      "Live execution and durable Privy signing must be configured.",
    );
  r.onError((e, c) =>
    c.json(
      {
        error: {
          code: "spot_permission",
          message: e instanceof Error ? e.message : "Permission unavailable.",
        },
      },
      422,
    ),
  );
  r.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    did(c.get("user"));
    await next();
  });
  r.get("/", async (c) => {
    const u = c.get("user");
    return c.json({
      enabled: !!(
        o.enabled() &&
        o.healthy() &&
        o.vault.available &&
        o.appId &&
        o.secret
      ),
      fundingWallets: u.solanaWallets ?? [],
      grants: all(u.id).map((g) => signer.publicView(g)),
    });
  });
  r.get("/wallets", async (c) => {
    requireActive();
    const u = c.get("user"),
      user = did(u),
      res = await (o.fetch ?? fetch)(
        "https://api.privy.io/v1/users/" + encodeURIComponent(user),
        {
          redirect: "error",
          signal: AbortSignal.timeout(6500),
          headers: {
            "privy-app-id": o.appId!,
            authorization:
              "Basic " +
              Buffer.from(o.appId + ":" + o.secret).toString("base64"),
          },
        },
      );
    opt(res.ok, "Unable to read the connected Privy wallets.");
    const data = (await res.json()) as {
      id: string;
      linked_accounts: Array<{
        id?: string;
        type: string;
        address?: string;
        chain_type?: string;
        wallet_client_type?: string;
        connector_type?: string;
        user_can_sign?: boolean;
      }>;
    };
    opt(
      data.id === user && Array.isArray(data.linked_accounts),
      "Invalid wallet identity.",
    );
    return c.json({
      wallets: data.linked_accounts
        .filter(
          (a) =>
            a.type === "wallet" &&
            a.id &&
            a.address &&
            a.chain_type === "solana" &&
            a.connector_type === "embedded" &&
            a.wallet_client_type === "privy" &&
            a.user_can_sign === true,
        )
        .map((a) => ({ id: a.id, address: a.address })),
    });
  });
  r.post("/preview", async (c) => {
    requireActive();
    const u = c.get("user"),
      v = await body(c, proposal),
      at = now();
    opt(
      (await o.linked(u.id, v.fundingOwner)) && v.executor !== v.fundingOwner,
      "Link a separate funding wallet and execution wallet.",
    );
    for (const [k, x] of review) if (x.expires <= at) review.delete(k);
    opt(
      review.size < 1000 &&
        [...review.values()].filter((x) => x.owner === u.id).length < 8 &&
        new Set(v.stages).size === v.stages.length,
      "Permission preview limit reached.",
    );
    const st = await o.strategy(u.id, v.strategyId, v.version),
      w = st.workflow;
    opt(w, "Select a saved workflow.");
    const stages = v.stages.map((sid) => {
      const s = w.stages.find((x) => x.id === sid),
        m = w.assets.find((x) => x.id === s?.assetId);
      const selected = m?.resolution?.candidates.find(
        (x) => x.id === m.resolution?.selectedId,
      );
      opt(
        s?.side === "buy" &&
          s.leverage === 1 &&
          s.amount.unit === "usd" &&
          s.amount.value &&
          selected?.venue === "solana" &&
          selected.address &&
          selected.id === "sol:token:" + selected.address &&
          ["spot", "token"].includes(selected.kind ?? "") &&
          selected.address !== SPOT_USDC,
        "Choose fixed-USDC Solana spot entry stages.",
      );
      return {
        id: s.id,
        mint: selected.address,
        usd: s.amount.value,
        repeat: s.repeat?.maxTimes ?? (s.repeat ? 128 : 1),
      };
    });
    const quantities = stages.map((s) => usd6(s.usd)),
      cap = stages.reduce(
        (n, s, i) =>
          n + quantities[i] * BigInt(Math.min(s.repeat, v.maxOrders)),
        0n,
      );
    opt(
      cap > 0n && cap <= usd6(w.budgetUsd ?? 0),
      "Grant exceeds the reviewed strategy budget.",
    );
    const prices = await o.marks([
      ...new Set([SPOT_USDC, ...stages.map((x) => x.mint)]),
    ]);
    opt(
      prices[SPOT_USDC]?.decimals === 6 &&
        prices[SPOT_USDC].usd >= 0.98 &&
        prices[SPOT_USDC].usd <= 1.02,
      "USDC valuation outside the supported range.",
    );
    const pass = await Promise.all(
      stages.map(async (s, i) => {
        const quote = prices[s.mint],
          floor =
            (ratio(quantities[i], prices[SPOT_USDC], quote) *
              BigInt(10000 - v.slippageBps)) /
            10000n;
        const scope: SwapScope = {
          fundingOwner: v.fundingOwner,
          executor: v.executor,
          inputMint: SPOT_USDC,
          outputMint: s.mint,
          pool: await discoverDirectPool(SPOT_USDC, s.mint, o.fetch),
          inputAccount: associated(v.fundingOwner, SPOT_USDC),
          outputAccount: associated(v.fundingOwner, s.mint),
          unitsPerOrder: String(quantities[i]),
          minimumOutputUnits: String(floor),
          totalInputUnits: String(cap),
          feeCapLamports: "25000",
          expiresAt: at + v.durationMinutes * 60000,
        };
        validateScope(scope, at);
        return { stageId: s.id, scope };
      }),
    );
    const key = randomBytes(16).toString("hex"),
      plan = { strategyId: v.strategyId, version: v.version, stages: pass };
    review.set(key, {
      owner: u.id,
      did: did(u),
      walletId: v.walletId,
      plan,
      expires: at + 120000,
    });
    return c.json({
      previewId: key,
      expiresAt: at + 120000,
      ...plan,
      marketDecimals: Object.fromEntries(
        stages.map((s) => [s.mint, prices[s.mint].decimals]),
      ),
    });
  });
  r.post("/offer", async (c) => {
    requireActive();
    const u = c.get("user"),
      v = await body(
        c,
        z
          .object({
            previewId: key,
            consent: z.literal("create-scoped-permission"),
          })
          .strict(),
      );
    return c.json(
      await exclusive(u.id, async () => {
        const x = review.get(v.previewId);
        opt(x?.owner === u.id && x.expires > now(), "Preview expired.");
        await o.strategy(u.id, x.plan.strategyId, x.plan.version);
        opt(
          all(u.id).filter(
            (g) =>
              g.status !== "disabled" && g.stages[0].scope.expiresAt > now(),
          ).length < 4,
          "Active permission limit reached.",
        );
        const result = await signer.offer(
          { ownerId: u.id, did: x.did, walletId: x.walletId },
          x.plan,
        );
        review.delete(v.previewId);
        return result;
      }),
    );
  });
  r.post("/:id/setup", async (c) => {
    const u = c.get("user"),
      v = await body(c, z.object({ kind: z.enum(["approve", "revoke"]) }));
    if (v.kind === "approve") requireActive();
    return c.json(
      await exclusive(u.id, () =>
        signer.prepareSetup(u.id, c.req.param("id"), v.kind),
      ),
    );
  });
  r.post("/:id/setup/:setupId/submit", async (c) => {
    const v = await body(c, z.object({ signed: z.string().min(90).max(1800) }));
    const u = c.get("user");
    return c.json(
      await exclusive(u.id, () =>
        signer.submitSetup(
          u.id,
          c.req.param("id"),
          c.req.param("setupId"),
          v.signed,
        ),
      ),
    );
  });
  r.post("/:id/setup/:setupId/check", async (c) => {
    const u = c.get("user");
    return c.json(
      await exclusive(u.id, () =>
        signer.checkSetup(u.id, c.req.param("id"), c.req.param("setupId")),
      ),
    );
  });
  r.post("/:id/activate", async (c) => {
    requireActive();
    const u = c.get("user"),
      gid = c.req.param("id");
    await exclusive(u.id, () => signer.activate(u.id, gid));
    return c.json({ active: true });
  });
  r.post("/:id/disable", async (c) => {
    const u = c.get("user"),
      gid = c.req.param("id");
    await signer.disable(u.id, gid);
    return c.json({ disabled: true });
  });
  r.get("/:id/owner-revoke", async (c) =>
    c.json(
      await signer.soleProviderSigner(c.get("user").id, c.req.param("id")),
    ),
  );
  const wrap = (manual: Driver) =>
    withPrivySpot(manual, {
      signer,
      grants: all,
      rpc,
      linked: async (uid, wallet) =>
        !!o.enabled() && o.healthy() && (await o.linked(uid, wallet)),
      mode: o.mode,
      marks: o.marks,
      now,
    });
  return { routes: r, wrap, signer };
}
