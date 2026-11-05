import { liveOverview } from "./live-overview";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import type { User } from "../store";
import { HostError } from "../workflows/host";
import { Funding, MainnetHost, Net, publicError } from "./live-host";
import { LiveLimits } from "./live-authority";
import { verifiedEdgeCountry } from "./live-region";

type Env = { Variables: { user: User; requestId: string } };
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const orderId = z.string().regex(/^[0-9a-zA-Z_.:-]{1,105}$/);
const user = (c: Context<Env>) => c.get("user");
async function body<T extends z.ZodType>(
  c: Context<Env>,
  schema: T,
): Promise<z.output<T>> {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  if (!r.success)
    throw new HostError(
      422,
      "Check the selected wallet, amounts and order confirmation.",
    );
  return r.data;
}
const strategy = z
  .object({
    strategyId: z.string().max(100),
    version: z.number().int().positive(),
  })
  .strict();
export function liveRoutes(
  host: MainnetHost,
  rate: (id: string, n: number, ms: number) => void,
) {
  const r = new Hono<Env>(),
    d = host.d;
  const region = (c: Context<Env>) =>
    verifiedEdgeCountry(
      c.req.raw,
      d.config.SIWE_ORIGIN,
      d.config.QUIVER_EDGE_PUBLIC_KEY,
      d.now(),
    );
  r.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    const u = user(c);
    host.access.signedUser(u);
    const place = region(c);
    if (host.access.noteRegion(u.id, place)) await d.commit();
    if (c.req.method !== "GET") {
      rate("live:" + u.id, 80, 60000);
      // Keep read-only receipt checks, pauses, cancellation and local revocation accessible when the verified edge is unavailable.
      const active =
        /\/(consent|start|confirm|grant|activate|claim|offer|prepare|preview|setup|submit)$/.test(
          c.req.path,
        );
      if (active && !place)
        throw new HostError(
          403,
          "Verified site location is required. Reopen the trading workspace on its public origin.",
        );
    }
    await next();
  });
  r.onError((e, c) => {
    const status = e instanceof HostError ? e.status : 422;
    return c.json(
      {
        error: {
          code:
            status === 403
              ? "forbidden"
              : status === 404
                ? "not_found"
                : status === 429
                  ? "rate_limited"
                  : status === 503
                    ? "unavailable"
                    : "live_order_blocked",
          message: publicError(
            e instanceof Error ? e.message : "Mainnet verification failed.",
          ),
          requestId: c.get("requestId"),
        },
      },
      status,
    );
  });
  r.route("/spot-permissions", host.spot.routes);
  r.get("/overview", async (c) =>
    c.json(await liveOverview(d.store, host.coord, user(c).id, d.now())),
  );
  r.post("/hyperliquid/check", async (c) =>
    c.json(await host.access.refreshGrant(user(c))),
  );
  r.get("/account", (c) =>
    c.json({
      ...host.access.public(user(c)),
      region: region(c),
      runs: host.list(user(c).id),
      allowances: host.allowances.list(user(c).id),
    }),
  );
  r.get("/wallet/balance", async (c) => {
    rate("live:balances:" + user(c).id, 18, 60000);
    const n = Net.parse(c.req.query("network")),
      w = c.req.query("wallet");
    if (!w || w.length > 80)
      throw new HostError(422, "Choose a linked wallet.");
    return c.json(await host.account(user(c), n, w));
  });
  r.post("/consent", async (c) => {
    const b = await body(
      c,
      z
        .object({
          version: z.string().max(120),
          residence: z.string().regex(/^[A-Z]{2}$/),
          nonUs: z.boolean(),
          acceptRealFunds: z.literal(true),
          limits: LiveLimits,
        })
        .strict(),
    );
    return c.json(host.access.agree(user(c), b, region(c)));
  });
  r.post("/pause", async (c) => {
    const u = user(c);
    host.access.pause(u);
    for (const g of d.store.privySpotGrants.values())
      if (g.ownerId === u.id) {
        g.sealed = "";
        g.status = "disabled";
        g.revision++;
      }
    await d.commit();
    for (const p of host.list(u.id))
      if (p.status === "running")
        await host.coord.control(u.id, p.id, "pause").catch(() => {});
    return c.json(host.access.public(u));
  });
  r.post("/hyperliquid/grant", async (c) => {
    const b = await body(
      c,
      z
        .object({
          master: z.string().refine((a) => isAddress(a)),
          hours: z.number().int().min(1).max(168),
          realTradingAuthority: z.literal(true),
        })
        .strict(),
    );
    return c.json(host.access.newGrant(user(c), b.master as Address, b.hours));
  });
  r.post("/hyperliquid/activate", async (c) => {
    const b = await body(c, z.object({ signature }).strict());
    return c.json(await host.access.activate(user(c), b.signature as Hex));
  });
  r.post("/hyperliquid/revoke-request", (c) =>
    c.json(host.access.revokePrompt(user(c))),
  );
  r.post("/hyperliquid/revoke", async (c) => {
    const b = await body(c, z.object({ signature }).strict());
    return c.json(await host.access.revoke(user(c), b.signature as Hex));
  });
  r.post("/review", async (c) => {
    const b = await body(c, strategy);
    return c.json(await host.review(user(c), b.strategyId, b.version));
  });
  r.post("/start", async (c) => {
    const b = await body(
      c,
      strategy
        .extend({
          reviewHash: digest,
          key: z.string().regex(/^[a-zA-Z0-9_.:-]{12,100}$/),
          network: z.literal("mainnet"),
          acceptRealOrders: z.literal(true),
          mode: z.enum(["auto", "confirm_each"]),
          slippageBps: z.number().int().min(1).max(500),
          wallets: z.array(Funding).min(1).max(3),
        })
        .strict(),
    );
    return c.json(await host.start(user(c), b), 201);
  });
  r.get("/runs", (c) => c.json({ items: host.list(user(c).id) }));
  r.get("/runs/:id", async (c) =>
    c.json(await host.coord.view(user(c).id, c.req.param("id"))),
  );
  r.post("/runs/:id/control", async (c) => {
    const b = await body(
      c,
      z.object({ command: z.enum(["pause", "resume", "stop"]) }).strict(),
    );
    if (b.command === "resume") {
      if (!region(c))
        throw new HostError(
          403,
          "Verify your network location before resuming.",
        );
      const p = await host.programs.read(user(c).id, c.req.param("id"));
      if (!p) throw new HostError(404, "Run not found.");
      for (const a of p.wallets)
        host.access.require(user(c).id, a.network, a.wallet);
    }
    return c.json(
      await host.coord.control(user(c).id, c.req.param("id"), b.command),
    );
  });
  r.post("/runs/:id/confirm", async (c) => {
    const b = await body(
      c,
      z
        .object({
          orderId,
          digest,
          value: z.union([
            z.string().max(8000),
            z.record(z.string(), z.unknown()),
          ]),
          acceptRealOrder: z.literal(true),
        })
        .strict(),
    );
    const p = await host.programs.read(user(c).id, c.req.param("id")),
      o = p?.orders[b.orderId];
    if (!o || !host.access.allow(user(c).id, o.action))
      throw new HostError(
        403,
        "This order no longer has permission to use the wallet.",
      );
    type Value = Extract<
      Parameters<typeof host.coord.confirm>[4],
      { kind: "wallet" }
    >["value"];
    return c.json(
      await host.coord.confirm(
        user(c).id,
        c.req.param("id"),
        b.orderId,
        b.digest,
        { kind: "wallet", value: b.value as Value },
      ),
    );
  });
  r.post("/runs/:id/cancel", async (c) => {
    const b = await body(c, z.object({ orderId }).strict());
    return c.json(
      await host.coord.cancel(user(c).id, c.req.param("id"), b.orderId),
    );
  });
  r.post("/runs/:id/close", async (c) => {
    const b = await body(c, z.object({ stage: z.string().max(32) }).strict());
    return c.json(
      await host.coord.close(user(c).id, c.req.param("id"), b.stage),
    );
  });
  r.post("/runs/:id/wallet-receipt", async (c) => {
    const b = await body(c, z.object({ orderId, digest, txHash }).strict());
    return c.json(
      await host.coord.walletReceipt(
        user(c).id,
        c.req.param("id"),
        b.orderId,
        b.digest,
        b.txHash,
      ),
    );
  });
  r.post("/runs/:id/refresh", async (c) => {
    const p = await host.programs.read(user(c).id, c.req.param("id"));
    if (!p) throw new HostError(404, "Run not found.");
    host.announceTick(user(c).id, p.id);
    return c.json(await host.coord.view(user(c).id, p.id));
  });
  r.post("/allowances/:id/claim", async (c) => {
    const b = await body(
      c,
      z
        .object({ digest: txHash, acceptRealAllowance: z.literal(true) })
        .strict(),
    );
    return c.json(
      await host.allowances.claim(user(c), c.req.param("id"), b.digest),
    );
  });
  r.post("/allowances/:id/receipt", async (c) => {
    const b = await body(c, z.object({ txHash: txHash.optional() }).strict());
    return c.json(
      await host.allowances.refresh(
        user(c),
        c.req.param("id"),
        b.txHash as Hex | undefined,
      ),
    );
  });
  r.post("/allowances/:id/decline", (c) =>
    c.json(host.allowances.decline(user(c), c.req.param("id"))),
  );
  return r;
}
