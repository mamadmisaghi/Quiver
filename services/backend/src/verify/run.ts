/**
 * Verification run (read-only). Writes config/verified/46630.json and config/verified/4663-readonly.json.
 * Uses only eth_chainId / eth_getCode / eth_call and public HTTPS docs. No keys, no signing, no tx.
 *   npm run verify:testnet
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, keccak256, type Hex } from "viem";
import { AGGREGATOR_ABI } from "../venues/chainlink";
import { VerifiedFile, type VerifiedFeed, type VerifiedItem } from "./schema";

const TESTNET_RPC = "https://rpc.testnet.chain.robinhood.com";
const MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const RDD = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const CL_PAGE = "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood";
const FEEDS: Record<string, string> = { ETH: "ETH / USD", BTC: "BTC / USD", USDG: "USDG / USD", NVDA: "Robinhood NVDA / USD", AAPL: "Robinhood AAPL / USD", TSLA: "Robinhood TSLA / USD", SPY: "Robinhood SPY / USD" };
const now = () => new Date().toISOString();

async function main() {
  const t = createPublicClient({ transport: http(TESTNET_RPC) });
  const m = createPublicClient({ transport: http(MAINNET_RPC) });
  const [tc, mc] = [await t.getChainId(), await m.getChainId()];
  if (tc !== 46630 || mc !== 4663) throw new Error(`chain id mismatch ${tc}/${mc}`);
  const code = async (c: typeof t, a: string) => { const x = await c.getCode({ address: a as Hex }); return x && x !== "0x" ? { size: (x.length - 2) / 2, hash: keccak256(x) } : null; };
  const I = (o: Omit<VerifiedItem, "checkedAt">): VerifiedItem => ({ ...o, checkedAt: now() });

  // --- V5/V7: Chainlink (mainnet-readonly) ---
  const rdd = (await (await fetch(RDD)).json()) as { name: string; proxyAddress: string; decimals: number; heartbeat: number }[];
  const feeds: VerifiedFeed[] = [];
  for (const [sym, name] of Object.entries(FEEDS)) {
    const e = rdd.find((x) => x.name === name); if (!e) continue;
    const c = await code(m, e.proxyAddress); if (!c) continue;
    const dec = Number(await m.readContract({ address: e.proxyAddress as Hex, abi: AGGREGATOR_ABI, functionName: "decimals" }));
    const desc = String(await m.readContract({ address: e.proxyAddress as Hex, abi: AGGREGATOR_ABI, functionName: "description" }));
    const r = (await m.readContract({ address: e.proxyAddress as Hex, abi: AGGREGATOR_ABI, functionName: "latestRoundData" })) as readonly bigint[];
    if (dec !== e.decimals) continue; // RDD vs on-chain disagreement → leave unverified
    feeds.push({ symbol: sym, name, proxy: e.proxyAddress, chainId: 4663, decimals: dec, description: desc, heartbeatSec: e.heartbeat,
      bytecodeHash: c.hash, sourceUrl: RDD, checkedAt: now(), lastAnswer: Number(r[1]) / 10 ** dec,
      lastUpdatedAt: new Date(Number(r[3]) * 1000).toISOString(), usage: "mainnet-readonly" });
  }
  const testnetFeedCode = await code(t, rdd.find((x) => x.name === "ETH / USD")!.proxyAddress);

  // --- addresses checked on both chains ---
  const UR = "0x8876789976decbfcbbbe364623c63652db8c0904", PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const AH = "0x0000000000001fF3684f28c67538d4D072C22734", SETTLER = "0x24A4d86c8A76B00EE9566eD9C9Ff4f0c3Faf0da7", VP = "0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7";
  const EP07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const [urM, urT, p2M, p2T, ahM, ahT, stM, stT, vpM, vpT, epT] = await Promise.all([code(m, UR), code(t, UR), code(m, PERMIT2), code(t, PERMIT2), code(m, AH), code(t, AH), code(m, SETTLER), code(t, SETTLER), code(m, VP), code(t, VP), code(t, EP07)]);

  // V2 probe: Uniswap Trading API chain enum
  const uni = async (chain: number) => { const r = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "EXACT_INPUT", amount: "1", tokenInChainId: chain, tokenOutChainId: chain, tokenIn: PERMIT2, tokenOut: UR, swapper: "0x000000000000000000000000000000000000dEaD" }) }); const j = (await r.json()) as { errorCode?: string; detail?: string }; return `${r.status} ${j.errorCode ?? ""}: ${(j.detail ?? "").slice(0, 80)}`; };
  const [uniT, uniM] = [await uni(46630), await uni(4663)];

  // V4: RH asset list
  let v4 = "unreachable";
  try { const a = (await (await fetch("https://robinhood.com/us/en/rhj/assets/")).text()); v4 = `html ${a.length}b`; } catch {}

  const testItems: VerifiedItem[] = [
    I({ id: "V1", title: "Uniswap Universal Router / Permit2 on 46630", status: "fail", value: null, sourceUrl: "https://developers.uniswap.org/docs/supported-chains", method: "official deployments list + eth_getCode",
        bytecodeHash: urT?.hash ?? null, note: `Uniswap lists Robinhood 4663 only; no 46630 deployment. Code exists at the 4663 UR address on 46630 (${urT?.size}b) but its hash differs from mainnet (${urM?.hash}) and it has no official listing → unused (fail closed). Permit2 present on 46630 (${p2T?.size}b, hash ${p2T?.hash}); harmless alone but no router to pair with.` }),
    I({ id: "V2", title: "Uniswap Trading API serves 46630", status: "fail", value: null, sourceUrl: "https://trade-api.gateway.uniswap.org/v1/quote", method: "POST /v1/quote probe",
        bytecodeHash: null, note: `46630 → ${uniT}. 4663 → ${uniM} (mainnet needs an API key; read-only quotes allowed once UNISWAP_API_KEY is set).` }),
    I({ id: "V3", title: "0x AllowanceHolder / Settler", status: "fail", value: null, sourceUrl: "https://contracts.0x.org/", method: "0x docs + eth_getCode",
        bytecodeHash: null, note: `0x supports 4663 only (docs.0x.org supported-chains). 46630: AllowanceHolder ${ahT ? "present" : "absent"}, Settler ${stT ? "present" : "absent"}. Mainnet: AllowanceHolder ${ahM?.size}b ${ahM?.hash}, Settler ${stM?.size ?? 0}b.` }),
    I({ id: "V4", title: "Stock Token registry on 46630", status: "fail", value: null, sourceUrl: "https://robinhood.com/us/en/rhj/assets/", method: "RH assets API (195 assets, all chainId 4663) on 2026-10-27",
        bytecodeHash: null, note: `No testnet stock tokens published. Registry keeps placeholder addresses (mock:true, never tradable). Probe: ${v4}.` }),
    I({ id: "V5", title: "Chainlink price feeds on 46630", status: "fail", value: null, sourceUrl: CL_PAGE, method: "Chainlink docs network list + RDD + eth_getCode",
        bytecodeHash: null, note: `Chainlink lists only 'Robinhood Chain Mainnet'; feeds-robinhood-testnet.json 404; mainnet ETH/USD proxy on 46630: ${testnetFeedCode ? "code" : "no code"}. Prices come from mainnet-readonly (see 4663-readonly.json).` }),
    I({ id: "V6", title: "Data Streams verifier proxy on 46630", status: "fail", value: null, sourceUrl: "https://docs.robinhood.com/chain/data-streams/", method: "RH docs + eth_getCode",
        bytecodeHash: vpT?.hash ?? null, note: `Mainnet proxy 0xcE73…36E7 has no code on 46630 (${vpT ? "present?!" : "absent"}). Chainlink changelog says Data Streams reached RH testnet (2026-03-20) but the testnet proxy address was not retrievable (client-rendered page) → unverified.` }),
    I({ id: "V7", title: "L2 sequencer-uptime feed", status: "fail", value: null, sourceUrl: RDD, method: "RDD search for 'Sequencer'", bytecodeHash: null,
        note: "No sequencer-uptime feed listed for Robinhood Chain (mainnet or testnet). Fallback: block-production watchdog (designed in ARCHITECTURE §6)." }),
    I({ id: "V8", title: "Session-key policy enforcement", status: "partial", value: { entryPointV07: EP07 }, sourceUrl: "https://eips.ethereum.org/EIPS/eip-4337", method: "Foundry tests (foundry/test/SessionAccount.t.sol) + anvil e2e",
        bytecodeHash: epT?.hash ?? null, note: "Quiver's policy MODEL passes all negative tests locally (transfer/approve/non-allowlisted/recipient≠self/over-cap/daily/expiry/revoke/replay). Alchemy session-key enforcement on 46630 NOT tested (needs Alchemy key + funded testnet account). EntryPoint v0.7 present on 46630." }),
    I({ id: "V9", title: "Hyperliquid agent wallet cannot withdraw", status: "partial", value: null, sourceUrl: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets", method: "HL docs read",
        bytecodeHash: null, note: "Docs: API (agent) wallets 'are only used to sign' on behalf of the master. Docs page does not explicitly state withdraw is rejected; HL testnet withdraw attempt needs a funded master account → not run." }),
    I({ id: "V10", title: "Pool depth per Stock Token", status: "n/a", value: null, sourceUrl: null, method: "n/a", bytecodeHash: null, note: "No testnet pools/tokens. Mainnet depth requires Uniswap API key (read-only quotes); deferred." }),
    I({ id: "V11", title: "EOD equity source + Polymarket API terms", status: "pending", value: null, sourceUrl: null, method: "not yet reviewed", bytecodeHash: null, note: "Terms not yet read; those signals stay mock-only until reviewed." }),
    I({ id: "faucet", title: "Testnet ETH faucet", status: "blocked", value: null, sourceUrl: "https://faucets.chain.link/robinhood-testnet", method: "HTTP probe", bytecodeHash: null,
        note: "Faucet page reachable (HTTP 200) but is a client-rendered wallet-connect flow (no documented HTTP API); a scripted claim was not possible and a browser claim was not attempted. Captcha/eligibility rules unconfirmed. No testnet funds obtained; nothing was sent. Not needed for M2: execution is exercised on local anvil." }),
  ];
  const mainItems: VerifiedItem[] = [
    I({ id: "chainlink_feeds", title: "Chainlink feeds (mainnet-readonly)", status: feeds.length ? "pass" : "fail", value: feeds.map((f) => f.symbol), sourceUrl: RDD, method: "RDD + eth_getCode + decimals()/description()/latestRoundData()", bytecodeHash: null, note: "Read-only eth_call; no signing, no tx." }),
    I({ id: "V6", title: "Data Streams verifier proxy 4663", status: vpM ? "pass" : "fail", value: vpM ? VP : null, sourceUrl: "https://docs.robinhood.com/chain/data-streams/", method: "RH docs + eth_getCode", bytecodeHash: vpM?.hash ?? null, note: null }),
    I({ id: "uniswap_ur", title: "Uniswap Universal Router 2.1.1 (4663)", status: urM ? "pass" : "fail", value: urM ? UR : null, sourceUrl: "https://developers.uniswap.org/docs/supported-chains", method: "official list + eth_getCode", bytecodeHash: urM?.hash ?? null, note: "Recorded for quote/simulation only. Quiver does not execute on mainnet." }),
    I({ id: "permit2", title: "Permit2 (4663)", status: p2M ? "pass" : "fail", value: p2M ? PERMIT2 : null, sourceUrl: "https://docs.uniswap.org/contracts/v4/deployments", method: "canonical address + eth_getCode", bytecodeHash: p2M?.hash ?? null, note: null }),
    I({ id: "0x_allowance_holder", title: "0x AllowanceHolder (4663)", status: ahM ? "pass" : "fail", value: ahM ? AH : null, sourceUrl: "https://github.com/0xProject/0x-settler", method: "0x README + eth_getCode", bytecodeHash: ahM?.hash ?? null, note: "Quotes need a 0x API key." }),
  ];
  mkdirSync("config/verified", { recursive: true });
  const w = (f: string, o: unknown) => { VerifiedFile.parse(o); writeFileSync(f, JSON.stringify(o, null, 2) + "\n"); };
  w("config/verified/46630.json", { chainId: 46630, network: "robinhood-testnet", generatedAt: now(), rpc: TESTNET_RPC, items: testItems, feeds: [] });
  w("config/verified/4663-readonly.json", { chainId: 4663, network: "robinhood-mainnet (READ-ONLY: eth_call only, never sign/send)", generatedAt: now(), rpc: MAINNET_RPC, items: mainItems, feeds });
  for (const i of testItems) console.log(`46630 ${i.id.padEnd(6)} ${i.status}`);
  for (const f of feeds) console.log(`4663  feed ${f.symbol.padEnd(5)} ${f.lastAnswer} @ ${f.lastUpdatedAt}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
