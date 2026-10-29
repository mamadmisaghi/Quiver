import { listenOpts } from "./listen";
import { JupiterPrice } from "./venues/jupiter";
import type { AssetInfo } from "./api/app";
import { serve } from "@hono/node-server";
import { createPublicClient, http } from "viem";
import { createApp } from "./api/app";
import { Warmup, listenThenWarm } from "./warmup";
import { installPersistGuards } from "./persist";
import { installShutdownSignals, makeGracefulStop } from "./shutdown";
import { ConfigError, describeConfig, loadConfig } from "./config";
import { Verified } from "./verify/loader";
import { ChainlinkReader, type ReadClient } from "./venues/chainlink";
import { TiingoEod } from "./venues/eod-vendor";
import { ReadonlyMarket } from "./venues/readonly-market";
import { MOCK_INSTRUMENTS, Registry } from "./venues/registry";
import { MemStore } from "./store";
import { PostgresPersistence } from "./storage/postgres";

async function boot() {
  const config = loadConfig(process.env);
  const production = config.NODE_ENV?.toLowerCase() === "production";
  if (production && (!config.DATABASE_URL || !config.QUIVR_JWT_SECRET)) throw new ConfigError("Production requires durable storage and a stable JWT secret", ["DATABASE_URL", "QUIVR_JWT_SECRET"]);
  // Real execution adapters are not shipped yet. Never boot them through configuration alone.
  if (config.QUIVR_MODE === "mainnet" || config.CHAIN_ID === 4663) throw new ConfigError("Mainnet execution is not implemented; use paper beta", ["QUIVR_MODE"]);
  const store = new MemStore();
  const durable = config.DATABASE_URL ? await PostgresPersistence.open(config.DATABASE_URL, store) : undefined;
  let draining = false;
  let market: ReadonlyMarket | undefined; let timer: NodeJS.Timeout | undefined; let assetInfo: AssetInfo | undefined; let jupTimer: NodeJS.Timeout | undefined;
  const registry = new Registry(MOCK_INSTRUMENTS);
  let warmLoad: (() => Promise<{ errors: number }>) | null = null; // M5.21 (B6): history loads after listen()
  if (config.PRICE_SOURCE === "mainnet-readonly") {
    const verified = Verified.load(config.VERIFIED_READONLY_PATH);
    if (verified.error) console.error(JSON.stringify({ level: "warn", msg: "verified file unusable; all Robinhood prices fail closed", error: verified.error }));
    // Read-only client: http transport only, no account → cannot sign or send.
    const client = createPublicClient({ transport: http(config.MAINNET_READONLY_RPC_URL, { batch: { batchSize: 50, wait: 10 }, timeout: 15_000 }) }) as unknown as ReadClient;
    const jv = verified.jupiter(); const jup = jv ? new JupiterPrice(jv.mint, config.JUPITER_PRICE_API_URL, undefined, 180_000, config.JUPITER_API_KEY) : null;
    market = new ReadonlyMarket(registry, new ChainlinkReader(client, verified), (s) => !!verified.feed(s), (s) => verified.feed(s)?.heartbeatSec ?? 86_400, 600, jup);
    if (jup) jupTimer = setInterval(() => void jup.refresh().catch(() => {}), 30_000);
    assetInfo = (m) => m.venue === "robinhood" ? ((a) => (a ? { ...a, chainId: 4663 } : null))(verified.tokenAddress(m.symbol))
      : m.symbol === "JUP" && jv ? { address: jv.mint, chainId: null, source: jv.source } : null;
    const mk = market;
    warmLoad = async () => {
      if (jup) await jup.refresh().catch((e) => console.error(JSON.stringify({ level: "warn", msg: "jupiter price unavailable", error: String(e) })));
      const r = await mk.refresh();
      console.log(JSON.stringify({ level: "info", msg: "mainnet-readonly prices loaded", symbols: r.symbols, errors: r.errors }));
      let n = Array.isArray(r.errors) ? r.errors.length : 0;
      if (config.TIINGO_API_KEY) { const m = await mk.loadModeled(new TiingoEod(config.TIINGO_API_KEY), Date.now() - 365 * 86_400_000); n += m.errors.length; console.log(JSON.stringify({ level: "info", msg: "modeled EOD history loaded (tiingo)", errors: m.errors })); }
      return { errors: n };
    };
    timer = setInterval(() => void market!.refresh().catch(() => {}), 60_000);
  }
  const persistPath = !durable && config.QUIVR_MODE === "mock" && process.env.QUIVR_DEV_PERSIST !== "0" ? (process.env.QUIVR_DEV_PERSIST_PATH ?? ".data/dev-store.json") : null;
  let gracefulStop: (r: "ops") => unknown = () => {};
  const warmup = new Warmup(Date.now, !!warmLoad);
  const { app, runs, persist } = createApp({ config, store, durable, isDraining: () => draining, market, warmup, registry, persistPath, assetInfo, onShutdown: () => gracefulStop("ops") });
  if (durable) {
    durable.beforeCommit = async () => { for (const [id, cp] of await runs.checkpoints()) store.runCheckpoints.set(id, cp); };
    durable.onFailure = () => { draining = true; runs.shutdown(); console.error(JSON.stringify({ level: "error", msg: "Durable storage lost; engine stopped. Restart required." })); };
    await durable.commit();
  }
  // Saves timer-driven events even when no browser is connected.
  let saving = false;
  const durableTimer = durable ? setInterval(() => { if (saving || draining) return; saving = true; void durable.commit().catch(() => {}).finally(() => { saving = false; }); }, 2000) : undefined;
  durableTimer?.unref?.();
  if (persist) installPersistGuards();
  if (persist) console.log(JSON.stringify({ level: "info", msg: "dev persistence on (mock mode)", path: persist.path }));
  if (config.DEV_LOGIN_ENABLED) console.warn(JSON.stringify({ level: "warn", msg: "DEV LOGIN ENABLED: anyone can sign in as any dev:<label>. Local/preview only; the preview must sit behind HTTP basic auth. Refused when NODE_ENV=production or on mainnet." }));
  let server!: ReturnType<typeof serve>;
  const listen = () => { server = serve({ fetch: app.fetch, ...listenOpts(config) }); console.log(JSON.stringify({ level: "info", msg: "quiver api listening", host: config.HOST, port: config.PORT, config: describeConfig(config) })); };
  if (warmLoad) void listenThenWarm(listen, warmup, warmLoad, config.WARMUP_MAX_MS).then(() => console.log(JSON.stringify({ level: "info", msg: "warmup finished", ...warmup.view() })));
  else listen();
  // M3.7: stop runs first (no tick can dirty the store after the flush), then flushSync, then close + exit.
  const stop = makeGracefulStop({
    extra: () => { draining = true; if (timer) clearInterval(timer); if (jupTimer) clearInterval(jupTimer); if (durableTimer) clearInterval(durableTimer); },
    stopRuns: () => runs.shutdown(),
    flush: async () => { persist?.stop(); if (durable) { await durable.commit(); await durable.close(); } },
    timeoutMs: 20_000,
    closeServer: (done) => { server.close(() => done()); (server as { closeAllConnections?: () => void }).closeAllConnections?.(); },
  });
  gracefulStop = stop;
  installShutdownSignals(stop);
  if (config.OPS_TOKEN) console.log(JSON.stringify({ level: "info", msg: "ops routes enabled (OPS_TOKEN set): POST /v1/ops/shutdown" }));
}
boot().catch((e) => {
  if (e instanceof ConfigError) { console.error(`Config error (fail closed): ${e.message}`); process.exit(1); }
  throw e;
});
