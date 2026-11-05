import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Address, Hex } from "viem";
import type { User } from "../store";
import { HostError } from "../workflows/host";
import { ExecutionService, OrderInput } from "./service";
import {
  orderUrl,
  pinOrder,
  bindSignature,
  actualFill,
  prepareExecution,
  settle,
  type JupiterOrder,
  type SimulationReply,
} from "./solana-jupiter";
import { decodeWire } from "./solana-wire";
type Env = { Variables: { user: User; requestId: string } };
const owner = (c: Context<Env>) => c.get("user");
const addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const amount = z.string().regex(/^[1-9][0-9]{0,18}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
async function body<T extends z.ZodType>(c: Context<Env>, s: T): Promise<z.output<T>> {
  const p = s.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new HostError(422, "Check the wallet, amount and limits.");
  return p.data;
}
export function executionRoutes(
  service: ExecutionService,
  d: { jupiter?: string; rpc?: string; now: () => number; commit: () => Promise<void> },
) {
  const r = new Hono<Env>();
  r.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  r.onError((e, c) => {
    const status = e instanceof HostError ? e.status : e instanceof z.ZodError ? 422 : 409;
    return c.json(
      {
        error: {
          code:
            status === 503
              ? "unavailable"
              : status === 403
                ? "forbidden"
                : status === 404
                  ? "not_found"
                  : "execution_blocked",
          message:
            e instanceof HostError
              ? e.message
              : e instanceof z.ZodError
                ? "The provider returned an unsupported response."
                : "The venue could not verify this request. Review its status before retrying.",
          requestId: c.get("requestId"),
        },
      },
      status,
    );
  });
  const locked = (c: Context<Env>, op: () => Promise<unknown>) =>
    service.exclusive(owner(c).id, op).then((data) => c.json(data as object));
  r.get("/", (c) => c.json({ ...service.view(owner(c)), solanaQuoteEnabled: !!(d.rpc && d.jupiter) }));
  r.post("/solana/challenge", async (c) => {
    const v = await body(c, z.object({ address: addr }));
    return c.json(service.challenge(owner(c), v.address));
  });
  r.post("/solana/link", async (c) => {
    const v = await body(
      c,
      z.object({ address: addr, nonce: z.string().max(128), signature: z.string().max(90) }),
    );
    return c.json(service.link(owner(c), v.address, v.nonce, v.signature));
  });
  r.post("/solana/unlink", async (c) => {
    const u = owner(c),
      v = await body(c, z.object({ address: addr }));
    u.solanaWallets = u.solanaWallets?.filter((a) => a !== v.address);
    return c.json(service.view(u));
  });
  r.post("/hyperliquid/grant", async (c) => {
    const b = await body(c, z.object({ master: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }));
    return locked(c, async () => service.grant(owner(c), b.master as Address));
  });
  r.post("/hyperliquid/activate", async (c) => {
    const b = await body(c, z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }));
    return locked(c, () => service.activate(owner(c), b.signature as Hex));
  });
  r.post("/hyperliquid/disable", (c) => locked(c, async () => service.disable(owner(c))));
  r.get("/hyperliquid/balance", async (c) => c.json(await service.balance(owner(c))));
  r.post("/hyperliquid/orders", async (c) => {
    const b = await body(c, OrderInput);
    return locked(c, () => service.prepare(owner(c), b));
  });
  r.post("/hyperliquid/orders/:id/confirm", async (c) => {
    const b = await body(c, z.object({ digest: hash }));
    return locked(c, () => service.confirm(owner(c), c.req.param("id"), b.digest));
  });
  r.post("/hyperliquid/orders/:id/cancel", (c) =>
    locked(c, () => service.cancel(owner(c), c.req.param("id"))),
  );
  r.post("/hyperliquid/orders/:id/reconcile", (c) =>
    locked(c, () => service.reconcile(owner(c), c.req.param("id"))),
  );
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    if (!d.rpc) throw new HostError(503, "Solana RPC is not configured.");
    const out = await fetch(d.rpc, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!out.ok) throw new HostError(503, "The Solana read endpoint is unavailable.");
    const v = (await out.json()) as { result: T; error?: unknown };
    if (v.error || v.result === undefined) throw new HostError(503, "The RPC could not verify this request.");
    return v.result;
  }
  r.get("/solana/balance/:address", async (c) => {
    const address = c.req.param("address");
    if (!owner(c).solanaWallets?.includes(address)) throw new HostError(404, "Linked wallet not found.");
    const balance = await rpc<{ value: number }>("getBalance", [address, { commitment: "finalized" }]);
    if (!Number.isSafeInteger(balance.value))
      throw new HostError(409, "Cannot represent this balance exactly.");
    return c.json({ mint: "SOL", lamports: String(balance.value) });
  });
  r.post("/solana/quotes", async (c) => {
    const u = owner(c),
      v = await body(
        c,
        z
          .object({
            taker: addr,
            inputMint: addr,
            outputMint: addr,
            inputAmount: amount,
            minOutput: amount,
            maxSlippageBps: z.number().int().min(1).max(100),
          })
          .strict(),
      );
    if (!u.solanaWallets?.includes(v.taker)) throw new HostError(403, "Link the swap wallet first.");
    if (!d.jupiter || !d.rpc)
      throw new HostError(503, "Authenticated Jupiter quotes and a trusted Solana RPC are required.");
    return locked(c, async () => {
      const a = service.record(u.id);
      a.swaps = (a.swaps ?? []).filter((s) => s.txid || s.pin.expiresAt > d.now());
      if (a.swaps.length >= 50) throw new HostError(429, "Quote history limit reached.");
      const intent = {
        ...v,
        ownerId: u.id,
        intentId: randomBytes(12).toString("hex"),
        maxImpactBps: 100,
        maxSwapFeeBps: 100,
        maxNetworkAndRentLamports: "10000000",
        expiresAt: d.now() + 30000,
      };
      const [response, height] = await Promise.all([
        fetch(orderUrl(intent), {
          headers: { "x-api-key": d.jupiter! },
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        }),
        rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]),
      ]);
      if (!response.ok) throw new HostError(503, "No executable Jupiter quote was available.");
      const pin = pinOrder(intent, (await response.json()) as JupiterOrder, d.now(), String(height));
      a.swaps.push({ pin });
      return {
        id: intent.intentId,
        transaction: pin.unsigned,
        expiresAt: pin.expiresAt,
        minimumOutput: pin.requiredOutput,
        messageHash: pin.messageHash,
      };
    });
  });
  r.post("/solana/quotes/:id/simulate", (c) =>
    locked(c, async () => {
      const u = owner(c),
        s = service.record(u.id).swaps?.find((s) => s.pin.intent.intentId === c.req.param("id"));
      if (!s || !u.solanaWallets?.includes(s.pin.intent.taker))
        throw new HostError(404, "Swap quote not found.");
      if (d.now() >= s.pin.expiresAt) throw new HostError(409, "The swap quote has expired.");
      const [sim, height] = await Promise.all([
        rpc<SimulationReply>("simulateTransaction", [
          s.pin.unsigned,
          { sigVerify: false, encoding: "base64", commitment: "confirmed", replaceRecentBlockhash: false },
        ]),
        rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]),
      ]);
      if (sim.value.replacementBlockhash || BigInt(height) > BigInt(s.pin.lastValidBlockHeight))
        throw new HostError(409, "Simulation used a different or expired blockhash.");
      try {
        return { status: "unsigned_simulation", ...actualFill(s.pin, decodeWire(s.pin.unsigned), sim.value) };
      } catch {
        throw new HostError(
          409,
          "The RPC did not prove all expected token and fee changes within the selected limits.",
        );
      }
    }),
  );
  r.post("/solana/quotes/:id/verify", async (c) => {
    const b = await body(c, z.object({ signed: z.string().max(3000) }));
    return locked(c, async () => {
      const u = owner(c),
        s = service.record(u.id).swaps?.find((s) => s.pin.intent.intentId === c.req.param("id"));
      if (!s || !u.solanaWallets?.includes(s.pin.intent.taker))
        throw new HostError(404, "Swap quote not found.");
      if (s.txid) throw new HostError(409, "Already verified.");
      bindSignature(s.pin, b.signed);
      const [sim, height] = await Promise.all([
        rpc<SimulationReply>("simulateTransaction", [
          b.signed,
          { sigVerify: true, encoding: "base64", commitment: "confirmed", replaceRecentBlockhash: false },
        ]),
        rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]),
      ]);
      const v = prepareExecution(s.pin, b.signed, sim, d.now(), String(height));
      s.txid = v.txid;
      await d.commit();
      return { status: "verified_only", txid: v.txid, simulated: v.expected };
    });
  });
  r.post("/solana/quotes/:id/receipt", (c) =>
    locked(c, async () => {
      const s = service.record(owner(c).id).swaps?.find((x) => x.pin.intent.intentId === c.req.param("id"));
      if (!s?.txid) throw new HostError(409, "A verified transaction ID is required.");
      const statuses = await rpc<{ value: Parameters<typeof settle>[2][] }>("getSignatureStatuses", [
        [s.txid],
        { searchTransactionHistory: true },
      ]);
      const status = statuses.value[0];
      const receipt =
        status?.confirmationStatus === "finalized"
          ? await rpc<Parameters<typeof settle>[3]>("getTransaction", [
              s.txid,
              { maxSupportedTransactionVersion: 0, encoding: "base64", commitment: "finalized" },
            ])
          : null;
      s.receipt = settle(s.pin, s.txid, status, receipt);
      return s.receipt;
    }),
  );
  return r;
}
