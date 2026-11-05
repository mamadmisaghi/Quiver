type Read = (url: string, init?: RequestInit) => Promise<unknown>;
export const wrappedSol = "So11111111111111111111111111111111111111112";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const positive = (x: unknown) => Number.isFinite(Number(x)) && Number(x) > 0;
type Pair = {
  chainId?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
};
export type SpotObservation = {
  price: number;
  source: string;
  at: number;
  slot?: number;
  liquidity?: number;
  volume?: number;
};

export function selectedPoolPrice(
  rows: unknown,
  mint: string,
  at: number,
): SpotObservation | null {
  if (!Array.isArray(rows)) return null;
  const candidates = (rows as Pair[]).flatMap((p) => {
    if (p?.chainId !== "solana" || !positive(p.priceUsd)) return [];
    const usd = Number(p.priceUsd);
    // Dexscreener denominates priceNative in quote tokens per one base token.
    const price =
      p.baseToken?.address === mint
        ? usd
        : p.quoteToken?.address === mint &&
            p.baseToken?.address === usdc &&
            positive(p.priceNative)
          ? usd / Number(p.priceNative)
          : 0;
    if (!positive(price)) return [];
    return [
      {
        price,
        at,
        source: "Dexscreener pool observation",
        liquidity: Number(p.liquidity?.usd) || undefined,
        volume: Number(p.volume?.h24) || undefined,
      },
    ];
  });
  return (
    candidates.sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0] ??
    null
  );
}

export function priceAtSlot(row: unknown, slot: number) {
  const m = row as
    | { usdPrice?: number; blockId?: number; decimals?: number }
    | undefined;
  if (
    !m ||
    typeof m.usdPrice !== "number" ||
    !positive(m.usdPrice) ||
    m.usdPrice >= 1e12 ||
    !Number.isSafeInteger(slot) ||
    slot <= 0 ||
    !Number.isSafeInteger(m.blockId) ||
    m.blockId! <= 0 ||
    m.blockId! > slot + 64 ||
    slot - m.blockId! > 450 ||
    !Number.isInteger(m.decimals) ||
    m.decimals! < 0 ||
    m.decimals! > 18
  )
    throw Error("Missing or stale independent USD price for the selected mint");
  return { usd: m.usdPrice, slot: m.blockId!, decimals: m.decimals! };
}

export async function spotObservation(
  mint: string,
  get: Read,
  now = Date.now,
): Promise<SpotObservation> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw Error("Invalid mint");
  try {
    const rows = await get(
      "https://api.dexscreener.com/tokens/v1/solana/" + mint,
    );
    const pool = selectedPoolPrice(rows, mint, now());
    if (pool) return pool;
  } catch {}
  const [prices, context] = await Promise.all([
    get("https://api.jup.ag/price/v3?ids=" + encodeURIComponent(mint)),
    get("https://api.mainnet-beta.solana.com/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSlot",
        params: [{ commitment: "confirmed" }],
      }),
    }),
  ]);
  const rpc = context as {
    jsonrpc?: string;
    id?: number;
    result?: number;
    error?: unknown;
  };
  if (
    rpc?.jsonrpc !== "2.0" ||
    rpc.id !== 1 ||
    rpc.error ||
    !Number.isSafeInteger(rpc.result)
  )
    throw Error("Mainnet slot unavailable");
  const mark = priceAtSlot(
    (prices as Record<string, unknown>)?.[mint],
    rpc.result!,
  );
  if (mint === wrappedSol && mark.decimals !== 9)
    throw Error("Unexpected SOL mint precision");
  return {
    price: mark.usd,
    source: "Jupiter spot reference",
    at: now(),
    slot: mark.slot,
  };
}
