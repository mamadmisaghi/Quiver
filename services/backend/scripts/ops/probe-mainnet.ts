/** Optional, credential-free, read-only external release evidence. No wallet data or dispatch methods are accepted. */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { HyperliquidVenue } from "../../src/execution/hyperliquid-testnet";
import { SolanaMainnet, USDC_MINT } from "../../src/execution/solana-mainnet";
import { WRAPPED_SOL } from "../../src/execution/solana-jupiter";
import {
  RobinhoodMainnet,
  RH_MAINNET_RPC,
} from "../../src/execution/robinhood-mainnet";
import { ROBINHOOD_ISSUER_ASSETS } from "../../src/compile/robinhood-assets";

const HL = "https://api.hyperliquid.xyz/info",
  SOL = "https://api.mainnet-beta.solana.com/",
  JUP = "https://api.jup.ag/price/v3";
const FEEDS =
  "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RH_READS = [
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
];
type Observation = {
  name: string;
  observed: boolean;
  details: Record<string, string | number | boolean>;
};
type Failure =
  | "timeout"
  | "public_rate_limit"
  | "transport"
  | "provider_rejected"
  | "read_guard"
  | "evidence_unavailable";
class ReadFailure extends Error {
  constructor(readonly category: Failure) {
    super(category);
  }
}
async function restricted(
  input: RequestInfo | URL,
  init: RequestInit,
  cap: { used: number; signal: AbortSignal; maximum: number },
  http: typeof fetch,
): Promise<Response> {
  if (cap.signal.aborted) throw new ReadFailure("timeout");
  if (++cap.used > cap.maximum) throw new ReadFailure("read_guard");
  const url = new URL(String(input)),
    clean = url.origin + url.pathname,
    method = (init.method ?? "GET").toUpperCase();
  let body: Record<string, unknown> = {};
  if (typeof init.body === "string")
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new ReadFailure("read_guard");
    }
  const allowed =
    !(url.username || url.password || url.hash) &&
    ((method === "GET" &&
      ([ROBINHOOD_ISSUER_ASSETS, FEEDS].includes(url.href) ||
        (clean === JUP &&
          url.searchParams.get("ids") === [USDC_MINT, WRAPPED_SOL].join(",") &&
          url.searchParams.size === 1))) ||
      (method === "POST" &&
        ((url.href === HL &&
          Object.keys(body).every((k) => k === "type" || k === "coin") &&
          ["meta", "l2Book"].includes(String(body.type))) ||
          (url.href === SOL &&
            (["getGenesisHash", "getSlot"].includes(String(body.method)) ||
              (body.method === "getMultipleAccounts" &&
                JSON.stringify((body.params as unknown[] | undefined)?.[0]) ===
                  JSON.stringify([USDC_MINT, WRAPPED_SOL])))) ||
          (url.origin === new URL(RH_MAINNET_RPC).origin &&
            url.pathname === "/" &&
            !url.search &&
            RH_READS.includes(String(body.method))))));
  if (
    !allowed ||
    new Headers(init.headers).has("authorization") ||
    new Headers(init.headers).has("x-api-key")
  )
    throw new ReadFailure("read_guard");
  let response: Response;
  try {
    const signal = AbortSignal.any([
      cap.signal,
      AbortSignal.timeout(9000),
      ...(init.signal ? [init.signal] : []),
    ]);
    response = await http(url, {
      ...init,
      signal,
      redirect: "error",
      credentials: "omit",
    });
  } catch (e) {
    throw new ReadFailure(
      cap.signal.aborted ||
      ["TimeoutError", "AbortError"].includes((e as Error).name)
        ? "timeout"
        : "transport",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ReadFailure(
      response.status === 429 ? "public_rate_limit" : "provider_rejected",
    );
  }
  return response;
}
async function limitedJson(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new ReadFailure("evidence_unavailable");
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const x = await reader.read();
      if (x.done) break;
      n += x.value.length;
      if (n > 3_000_000) {
        await reader.cancel();
        throw new ReadFailure("read_guard");
      }
      chunks.push(x.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function publicEvidence(
  http: typeof fetch = fetch,
  deadlineMs = 45000,
) {
  const cap = {
    used: 0,
    maximum: 160,
    signal: AbortSignal.timeout(deadlineMs),
  };
  const guarded: typeof fetch = (u, i = {}) => restricted(u, i, cap, http);
  const observed = async (
    name: string,
    fn: () => Promise<Observation["details"]>,
  ): Promise<Observation> => {
    try {
      return { name, observed: true, details: await fn() };
    } catch (e) {
      return {
        name,
        observed: false,
        details: {
          reason:
            e instanceof ReadFailure
              ? e.category
              : cap.signal.aborted
                ? "timeout"
                : "evidence_unavailable",
        },
      };
    }
  };
  const [perp, spot, stock] = await Promise.all([
    observed("hyperliquid-mainnet/BTC", async () => {
      const venue = new HyperliquidVenue("mainnet", (u, i) => guarded(u, i));
      const [market, book] = await Promise.all([
        venue.market("BTC"),
        venue.midpoint("BTC"),
      ]);
      return {
        symbol: market.symbol,
        assetId: market.asset,
        midpointUsd: book.price,
        observedAt: new Date(book.observedAt).toISOString(),
      };
    }),
    observed("solana-mainnet/USDC-SOL", async () => {
      // One aggregated keyless Jupiter price call. marks also verifies the mainnet genesis and observed slot.
      const prices = await new SolanaMainnet({ fetch: guarded }).marks([
        USDC_MINT,
        WRAPPED_SOL,
      ]);
      const raw = (await limitedJson(
        await guarded(SOL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 31,
            method: "getMultipleAccounts",
            params: [
              [USDC_MINT, WRAPPED_SOL],
              { commitment: "confirmed", encoding: "base64" },
            ],
          }),
        }),
      )) as {
        id?: number;
        jsonrpc?: string;
        error?: unknown;
        result?: {
          context?: { slot?: number };
          value?: {
            owner: string;
            executable: boolean;
            data: [string, string];
          }[];
        };
      };
      const mints = raw.result?.value,
        slot = raw.result?.context?.slot;
      if (
        raw.id !== 31 ||
        raw.jsonrpc !== "2.0" ||
        raw.error ||
        !Array.isArray(mints) ||
        mints.length !== 2 ||
        !Number.isSafeInteger(slot) ||
        (slot ?? 0) <
          Math.max(prices[USDC_MINT].slot, prices[WRAPPED_SOL].slot) - 64 ||
        !mints.every((a, i) => {
          if (
            !a ||
            a.owner !== SPL_TOKEN ||
            a.executable !== false ||
            a.data?.[1] !== "base64"
          )
            return false;
          const bytes = Buffer.from(a.data[0], "base64");
          return (
            bytes.length === 82 && bytes[44] === [6, 9][i] && bytes[45] === 1
          );
        })
      )
        throw new ReadFailure("evidence_unavailable");
      if (
        prices[USDC_MINT].decimals !== 6 ||
        prices[WRAPPED_SOL].decimals !== 9
      )
        throw new ReadFailure("evidence_unavailable");
      return {
        usdcUsd: prices[USDC_MINT].usd,
        solUsd: prices[WRAPPED_SOL].usd,
        solSlot: prices[WRAPPED_SOL].slot,
        verifiedMintDecimals: true,
        onchainMintSlot: slot!,
      };
    }),
    (async () => {
      let id = 0;
      const venue = new RobinhoodMainnet({
        rpc: async (method, params) => {
          const requestId = ++id;
          const r = await guarded(RH_MAINNET_RPC, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              method,
              params,
            }),
          });
          const v = (await limitedJson(r)) as {
            id?: number;
            jsonrpc?: string;
            error?: unknown;
            result?: unknown;
          };
          if (
            v.jsonrpc !== "2.0" ||
            v.id !== requestId ||
            v.error ||
            !("result" in v)
          )
            throw new ReadFailure("evidence_unavailable");
          return v.result;
        },
        assets: async () => limitedJson(await guarded(ROBINHOOD_ISSUER_ASSETS)),
        feeds: async () => limitedJson(await guarded(FEEDS)),
      });
      const contracts = await observed(
        "robinhood-4663/deployment",
        async () => {
          const d = await venue.verifyDeployment();
          return {
            chainId: d.chainId,
            block: d.blockNumber,
            blockHash: d.blockHash,
            observedAt: new Date(d.observedAt).toISOString(),
          };
        },
      );
      if (!contracts.observed)
        return [
          contracts,
          {
            name: "robinhood-4663/AAPL",
            observed: false,
            details: { reason: "deployment_unverified" },
          } satisfies Observation,
        ];
      const quote = await observed("robinhood-4663/AAPL", async () => {
        const m = await venue.spotPrice("AAPL");
        return {
          symbol: "AAPL",
          token: m.address,
          bidUsd: m.price,
          observedAt: new Date(m.observedAt).toISOString(),
        };
      });
      return [contracts, quote];
    })(),
  ]);
  const checks = [perp, spot, ...stock];
  return {
    sampledAt: new Date().toISOString(),
    allObserved: checks.every((c) => c.observed),
    calls: cap.used,
    checks,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const flags = process.argv.slice(2);
  if (
    flags.some((x) => x !== "--strict" && x !== "--report-only") ||
    flags.length > 1
  ) {
    console.error(
      "Usage: node --import tsx scripts/ops/probe-mainnet.ts [--strict|--report-only]",
    );
    process.exitCode = 2;
  } else {
    const result = await publicEvidence();
    console.log(JSON.stringify(result, null, 2));
    if (!result.allObserved && !flags.includes("--report-only"))
      process.exitCode = 1;
  }
}
