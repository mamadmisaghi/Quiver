import test from "node:test";
import assert from "node:assert/strict";
import { publicEvidence } from "./probe-mainnet";
import { MAINNET_GENESIS, USDC_MINT } from "../../src/execution/solana-mainnet";
import { WRAPPED_SOL } from "../../src/execution/solana-jupiter";
const NOW = () => Date.now();
test("reads are credential-free and external verification failures stay visible", async () => {
  const methods: string[] = [];
  const fixture: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    const h = new Headers(init?.headers);
    assert(!h.has("x-api-key"));
    assert(!h.has("authorization"));
    const b = init?.body && JSON.parse(String(init.body));
    if (u.hostname === "api.hyperliquid.xyz") {
      assert.equal(u.pathname, "/info");
      methods.push(b.type);
      if (b.type === "meta")
        return Response.json({
          collateralToken: 0,
          universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }],
        });
      if (b.type === "l2Book")
        return Response.json({
          coin: "BTC",
          time: NOW(),
          levels: [
            [{ px: "99999", sz: "2", n: 1 }],
            [{ px: "100001", sz: "3", n: 1 }],
          ],
        });
    }
    if (u.hostname === "api.mainnet-beta.solana.com") {
      methods.push(b.method);
      assert(
        ["getGenesisHash", "getSlot", "getMultipleAccounts"].includes(b.method),
      );
      const mints = [6, 9].map((dp) => {
        const data = Buffer.alloc(82);
        data[44] = dp;
        data[45] = 1;
        return {
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          executable: false,
          data: [data.toString("base64"), "base64"],
        };
      });
      return Response.json({
        jsonrpc: "2.0",
        id: b.id,
        result:
          b.method === "getGenesisHash"
            ? MAINNET_GENESIS
            : b.method === "getSlot"
              ? 10000
              : { context: { slot: 10000 }, value: mints },
      });
    }
    if (u.hostname === "api.jup.ag") {
      assert.equal(u.pathname, "/price/v3");
      assert.deepEqual(u.searchParams.get("ids")?.split(","), [
        USDC_MINT,
        WRAPPED_SOL,
      ]);
      return Response.json({
        [USDC_MINT]: { usdPrice: 1, blockId: 10000, decimals: 6 },
        [WRAPPED_SOL]: { usdPrice: 123, blockId: 9999, decimals: 9 },
      });
    }
    if (u.hostname === "rpc.mainnet.chain.robinhood.com")
      return Response.json({ error: "fixture" }, { status: 429 });
    throw Error("Unexpected network call");
  };
  const result = await publicEvidence(fixture, 2000);
  assert(!result.allObserved);
  assert.deepEqual(
    result.checks.map((x) => x.observed),
    [true, true, false, false],
  );
  assert.equal(result.checks[0].details.midpointUsd, 100000);
  assert.equal(result.checks[1].details.verifiedMintDecimals, true);
  assert.equal(result.checks[2].details.reason, "public_rate_limit");
  assert.equal(result.checks[3].details.reason, "deployment_unverified");
  assert.deepEqual(
    methods.sort(),
    [
      "getGenesisHash",
      "getMultipleAccounts",
      "getSlot",
      "l2Book",
      "meta",
    ].sort(),
  );
});
test("incorrect Solana genesis prevents the public Jupiter quote, and missing venues never fabricate evidence", async () => {
  let jupiterCalls = 0;
  const result = await publicEvidence(async (input, init) => {
    const u = new URL(String(input));
    if (u.hostname === "api.jup.ag") jupiterCalls++;
    if (u.hostname === "api.mainnet-beta.solana.com")
      return Response.json({ id: 1, jsonrpc: "2.0", result: "devnet" });
    return Response.json({ error: true }, { status: 503 });
  }, 2000);
  assert(!result.allObserved);
  assert.equal(jupiterCalls, 0);
  assert(result.checks.every((c) => !c.observed));
});
