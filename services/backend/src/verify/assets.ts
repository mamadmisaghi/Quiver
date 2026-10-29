/**
 * M3.3 asset-address verification (READ-ONLY: HTTP GETs + eth_call/eth_getCode on 4663; never signs or sends).
 * Upserts two items into config/verified/4663-readonly.json:
 *  - "rh_tokens_4663": Robinhood Stock Token addresses from the official RHJ assets API (the source the
 *    Robinhood Chain docs "Token Contracts" table is generated from) + WETH from the docs page; each checked
 *    on-chain (code exists, symbol() matches).
 *  - "jupiter_jup": JUP mint from Jupiter's Tokens API v2 (isVerified) + a live Price API v3 probe.
 * Usage: npx tsx src/verify/assets.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, keccak256, type Hex } from "viem";
import { VerifiedFile } from "./schema";

const FILE = "config/verified/4663-readonly.json";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
export const RHJ_ASSETS = "https://api.robinhood.com/rhj/assets";
export const RH_DOCS = "https://docs.robinhood.com/chain/contracts/";
export const JUP_TOKENS = "https://lite-api.jup.ag/tokens/v2/search?query=";
export const JUP_PRICE = "https://lite-api.jup.ag/price/v3?ids=";
const SYMBOLS = ["NVDA", "AAPL", "TSLA", "SPY"];
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const ERC20 = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;

async function main() {
  const now = new Date().toISOString();
  const c = createPublicClient({ transport: http(RPC) });
  if ((await c.getChainId()) !== 4663) throw new Error("chain id mismatch");
  const assets = (await (await fetch(RHJ_ASSETS)).json()) as { assets: { tokenSymbol: string; status: string; deployments: { contractAddress: string; chainId: number }[] }[] };
  const docs = await (await fetch(RH_DOCS)).text();
  const weth = docs.match(/WETH[^0]{0,200}(0x[0-9a-fA-F]{40})/)?.[1];
  const tokens: Record<string, { address: string; source: string; onchainSymbol: string; bytecodeHash: string }> = {}; const problems: string[] = [];
  const check = async (sym: string, address: string | undefined, source: string) => {
    if (!address) { problems.push(`${sym}: not found at ${source}`); return; }
    const code = await c.getCode({ address: address as Hex }); if (!code || code === "0x") { problems.push(`${sym}: no code`); return; }
    const onchain = (await c.readContract({ address: address as Hex, abi: ERC20, functionName: "symbol" })) as string;
    if (onchain !== sym) { problems.push(`${sym}: on-chain symbol ${onchain}`); return; }
    tokens[sym] = { address, source, onchainSymbol: onchain, bytecodeHash: keccak256(code) };
  };
  for (const s of SYMBOLS) {
    const a = assets.assets.filter((x) => x.tokenSymbol === s && x.status === "ASSET_STATUS_ACTIVE").flatMap((x) => x.deployments.filter((d) => d.chainId === 4663));
    await check(s, a.length === 1 ? a[0].contractAddress : undefined, RHJ_ASSETS);
  }
  await check("WETH", weth, RH_DOCS);

  const jt = ((await (await fetch(JUP_TOKENS + JUP_MINT)).json()) as { id: string; symbol: string; isVerified?: boolean }[]).find((x) => x.id === JUP_MINT);
  const jp = ((await (await fetch(JUP_PRICE + JUP_MINT)).json()) as Record<string, { usdPrice: number }>)[JUP_MINT];
  const jupOk = !!jt && jt.symbol === "JUP" && jt.isVerified === true && typeof jp?.usdPrice === "number";

  const f = VerifiedFile.parse(JSON.parse(readFileSync(FILE, "utf8")));
  const items = f.items.filter((i) => i.id !== "rh_tokens_4663" && i.id !== "jupiter_jup");
  items.push({ id: "rh_tokens_4663", title: "Robinhood Stock Token + WETH addresses (4663, read-only)", status: problems.length ? (Object.keys(tokens).length ? "partial" : "fail") : "pass",
    value: tokens, sourceUrl: RHJ_ASSETS, checkedAt: now, method: "RHJ assets API (docs Token Contracts table source) / docs page for WETH + eth_getCode + symbol()", bytecodeHash: null,
    note: `Read-only reference. Quiver does not trade on 4663.${problems.length ? " Problems: " + problems.join("; ") : ""}` });
  items.push({ id: "jupiter_jup", title: "JUP mint + Jupiter Price API v3 (Solana, read-only)", status: jupOk ? "pass" : "fail",
    value: jupOk ? { mint: JUP_MINT, symbol: "JUP", priceApi: "https://lite-api.jup.ag/price/v3" } : null, sourceUrl: "https://dev.jup.ag/docs/price/v3", checkedAt: now,
    method: "Jupiter Tokens API v2 (isVerified) + Price API v3 probe (keyless, 0.5 rps)", bytecodeHash: null, note: "Current price only (no history); keyless rate limit 0.5 req/s." });
  writeFileSync(FILE, JSON.stringify({ ...f, items, generatedAt: now }, null, 2) + "\n");
  console.log(JSON.stringify({ tokens: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v.address])), problems, jupOk }));
}
if (process.argv[1]?.endsWith("assets.ts")) main().catch((e) => { console.error(e); process.exit(1); });
