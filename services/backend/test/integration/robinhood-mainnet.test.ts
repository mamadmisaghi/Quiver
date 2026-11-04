import { robinhoodLiveDriver } from "../../src/execution/robinhood-live-driver";
import { robinhoodIssuerCandidate } from "../../src/compile/robinhood-assets";
import type {
  Action,
  WalletBudget,
  LiveProgram,
} from "../../src/execution/live-program";
import { describe, it, expect, vi } from "vitest";
import {
  parseAbi,
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import {
  RobinhoodMainnet,
  RH_USDG,
  RH_WETH,
  RH_V3,
  rhPoolAddress,
  type RhIntent,
  type RhPrepared,
  type RhRpc,
} from "../../src/execution/robinhood-mainnet";
// Only fixture code markers are substituted. All path, CREATE2, calldata, event and terms hashes are calculated by viem.
vi.mock("viem", async (importOriginal) => {
  const v = await importOriginal<typeof import("viem")>();
  return {
    ...v,
    keccak256: (d: Parameters<typeof v.keccak256>[0], ...args: unknown[]) => {
      const known: Record<string, Hex> = {
        "0x6091":
          "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc",
        "0x6092":
          "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28",
        "0x6093":
          "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739",
      };
      return (
        (typeof d === "string" && known[d]) || v.keccak256(d, ...(args as []))
      );
    },
  };
});
const A = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address,
  H = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const h = (n: bigint | number) => "0x" + n.toString(16);
const owner = A(1),
  stock = A(3),
  usdFeed = A(4),
  stockFeed = A(5),
  ethFeed = A(9),
  txHash = H(6);
const T = Date.UTC(2026, 10, 4, 15, 30),
  IN = 100000000n,
  OUT = 2000000000000000000n;
const spec: RhIntent = {
  owner,
  symbol: "AAPL",
  side: "buy",
  amountIn: IN.toString(),
  minOutput: "1",
  maxImpactBps: 200,
  slippageBps: 50,
  maxFeeWei: "100000000000000",
  eligible: true,
};
const abi = parseAbi([
  "function uid() view returns(bytes32)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
  "function description() view returns(string)",
  "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function getPool(address,address,uint24) view returns(address)",
  "function liquidity() view returns(uint128)",
  "function quoteExactInput(bytes,uint256) returns(uint256,uint160[],uint32[],uint256)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) returns(uint256)",
  "function multicall(uint256,bytes[]) returns(bytes[])",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const result = (functionName: string, value: unknown) =>
  encodeFunctionResult({
    abi,
    functionName: functionName as never,
    result: value as never,
  });
const abiData = (types: readonly string[], vs: readonly unknown[]) =>
  encodeAbiParameters(
    types.map((type) => ({ type: type as "uint256" })),
    vs as never,
  );
function fake() {
  const q = {
    now: T,
    allow: IN,
    badCode: false,
    tamperPair: false,
    stale: false,
    wrongChain: false,
    actual: OUT,
    oracle: 50_00000000n,
    balance: 10000000000000000000000n,
    active: true,
    badUid: false,
    fee: 1000000n,
    nonce: 2n,
    after: 2n,
    final: 10n,
    reorg: false,
    multi: false,
    archive: true,
    reply: true,
    ready: false,
    proof: undefined as undefined | RhPrepared,
    tx: {} as Record<string, unknown>,
    receipt: {} as Record<string, unknown>,
    calls: [] as string[],
  };
  function block(n: bigint, full: boolean) {
    return {
      number: h(n),
      hash: q.reorg && n === 11n ? H(800) : H(Number(n)),
      timestamp: h(BigInt(T / 1000) + n - 10n),
      transactions: n === 11n && q.ready ? [full ? q.tx : txHash] : [],
    };
  }
  const rpc: RhRpc = async (method, p) => {
    q.calls.push(method);
    if (method === "eth_chainId") return q.wrongChain ? "0x1" : "0x1237";
    if (method === "eth_getBlockByNumber") {
      const tag = p[0];
      const n =
        tag === "finalized"
          ? q.final
          : tag === "latest"
            ? q.ready
              ? 12n
              : 10n
            : BigInt(String(tag));
      return block(n, !!p[1]);
    }
    if (method === "eth_getCode") {
      if (q.badCode) return "0x6000";
      return p[0] === RH_V3.router
        ? "0x6091"
        : p[0] === RH_V3.quoter
          ? "0x6092"
          : "0x6093";
    }
    if (method === "eth_gasPrice") return h(q.fee);
    if (method === "eth_getBalance") return h(10n ** 18n);
    if (method === "eth_estimateGas") return h(100000);
    if (method === "eth_getTransactionCount") {
      if (typeof p[1] === "string" && p[1] !== "pending") {
        if (!q.archive) throw Error("archive unavailable");
        return h(BigInt(p[1]) >= 11n ? q.after : q.nonce);
      }
      return h(q.nonce);
    }
    if (method === "eth_getTransactionByHash")
      return q.reply && q.ready && p[0] === txHash ? q.tx : null;
    if (method === "eth_getTransactionReceipt")
      return q.ready ? q.receipt : null;
    if (method !== "eth_call") throw Error("Unsupported call " + method);
    const tx = p[0] as { to: Address; data: Hex };
    const { functionName: n, args } = decodeFunctionData({
      abi,
      data: tx.data,
    });
    if (n === "symbol") return result(n, tx.to === RH_USDG ? "USDG" : "AAPL");
    if (n === "uid") return result(n, q.badUid ? H(12) : H(8));
    if (n === "decimals")
      return result(n, tx.to === RH_USDG ? 6 : tx.to === stock ? 18 : 8);
    if (n === "description")
      return result(
        n,
        tx.to === usdFeed
          ? "USDG / USD"
          : tx.to === ethFeed
            ? "ETH / USD"
            : "RHAAPL / USD",
      );
    if (n === "latestRoundData")
      return result(n, [
        2n,
        tx.to === usdFeed
          ? 100000000n
          : tx.to === ethFeed
            ? 1000_00000000n
            : q.oracle,
        1n,
        BigInt(T / 1000) - (q.stale ? 100000n : 0n),
        2n,
      ]);
    if (n === "balanceOf") return result(n, q.balance);
    if (n === "allowance") return result(n, q.allow);
    if (n === "getPool") {
      const [a, b, f] = args as [Address, Address, number];
      const isMiddle = [a.toLowerCase(), b.toLowerCase()].includes(RH_WETH);
      return result(
        n,
        f === 500 && q.multi === isMiddle
          ? q.tamperPair
            ? A(9)
            : rhPoolAddress(a, b, f)
          : A(0),
      );
    }
    if (n === "liquidity") return result(n, 900000000000000000n);
    if (n === "quoteExactInput") return result(n, [q.actual, [], [], 50000n]);
    if (n === "approve") return result(n, true);
    if (n === "multicall") return result(n, [result("exactInput", q.actual)]);
    throw Error(n);
  };
  const assetRows = () =>
    Promise.resolve({
      assets: [
        {
          tokenSymbol: "AAPL",
          status: q.active ? "ASSET_STATUS_ACTIVE" : "ASSET_STATUS_INACTIVE",
          id: H(8),
          deployments: [{ chainId: 4663, contractAddress: stock }],
          tradingCapabilities: {
            fractionalTradability: "tradable",
            allDayTradability: "tradable",
            extendedHoursFractionalTradability: true,
          },
        },
      ],
    });
  const feeds = () =>
    Promise.resolve([
      {
        name: "USDG / USD",
        decimals: 8,
        heartbeat: 86400,
        proxyAddress: usdFeed,
      },
      {
        name: "ETH / USD",
        decimals: 8,
        heartbeat: 86400,
        proxyAddress: ethFeed,
      },
      {
        name: "Robinhood AAPL / USD",
        decimals: 8,
        heartbeat: 86400,
        proxyAddress: stockFeed,
      },
    ]);
  const venue = new RobinhoodMainnet({
    now: () => q.now,
    rpc,
    assets: assetRows,
    feeds,
  });
  function mined(
    p: RhPrepared,
    logs: Record<string, unknown>[] = [],
    status = "0x1",
  ) {
    q.ready = true;
    q.after = q.nonce + 1n;
    q.proof = p;
    q.final = 11n;
    q.tx = {
      from: owner,
      to: p.tx.to,
      nonce: p.tx.nonce,
      hash: txHash,
      gas: p.tx.gas,
      gasPrice: p.tx.gasPrice,
      blockHash: H(11),
      blockNumber: "0xb",
      input: p.tx.data,
      value: "0x0",
      chainId: "0x1237",
    };
    q.receipt = {
      transactionHash: txHash,
      blockHash: H(11),
      blockNumber: "0xb",
      from: owner,
      to: p.tx.to,
      transactionIndex: "0x0",
      status,
      gasUsed: "0x186a0",
      effectiveGasPrice: p.tx.gasPrice,
      logs: logs.map((r, i) => ({
        ...r,
        blockHash: H(11),
        blockNumber: "0xb",
        transactionHash: txHash,
        transactionIndex: "0x0",
        logIndex: h(i),
        removed: false,
      })),
    };
  }
  return { q, venue, mined };
}
function transfer(token: Address, from: Address, to: Address, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({
      abi,
      eventName: "Transfer",
      args: { from, to },
    }),
    data: abiData(["uint256"], [value]),
  };
}
function approval(token: Address, n: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({
      abi,
      eventName: "Approval",
      args: { owner, spender: RH_V3.router },
    }),
    data: abiData(["uint256"], [n]),
  };
}
function logs(p: RhPrepared, out: bigint) {
  const found: Record<string, unknown>[] = [],
    amounts =
      p.hops.length === 2
        ? [BigInt(p.inputUnits), 50_000_000n, out]
        : [BigInt(p.inputUnits), out];
  for (const [i, hop] of p.hops.entries()) {
    const receiver = i === p.hops.length - 1 ? owner : RH_V3.router,
      source = i ? RH_V3.router : owner,
      first = hop.tokenIn < hop.tokenOut;
    found.push(
      transfer(hop.tokenOut, hop.pool, receiver, amounts[i + 1]),
      transfer(hop.tokenIn, source, hop.pool, amounts[i]),
      {
        address: hop.pool,
        topics: encodeEventTopics({
          abi,
          eventName: "Swap",
          args: { sender: RH_V3.router, recipient: receiver },
        }),
        data: abiData(
          ["int256", "int256", "uint160", "uint128", "int24"],
          [
            first ? amounts[i] : -amounts[i + 1],
            first ? -amounts[i + 1] : amounts[i],
            1n,
            1n,
            0,
          ],
        ),
      },
    );
  }
  return found;
}
describe("Robinhood 4663 production swap binding", () => {
  it("prepares exact bounded calldata, re-simulates and settles one verified canonical fill", async () => {
    const { venue, q, mined } = fake(),
      p = await venue.prepare(spec);
    expect(p.kind).toBe("swap");
    expect(p.tx.to).toBe(RH_V3.router);
    expect(p.tx.nonce).toBe("0x2");
    expect(p.minimumOutputUnits).toBe(((OUT * 9950n) / 10000n).toString());
    expect(
      p.tx.data.startsWith(toFunctionSelector("multicall(uint256,bytes[])")),
    ).toBe(true);
    await venue.validate(p, true);
    await expect(venue.validate(p, false)).rejects.toThrow(/eligibility/);
    mined(p, logs(p, OUT));
    const r = await venue.reconcile(p, txHash);
    expect(r).toMatchObject({
      status: "filled",
      amountIn: String(IN),
      amountOut: String(OUT),
      txHash,
      feeWei: "100000000000",
      notionalUsd6: String(IN),
      blockTime: T + 1000,
    });
    expect(q.calls).not.toContain("eth_sendRawTransaction");
  });
  it("requires exact separate allowances and never counts approval as a fill", async () => {
    const { venue, q, mined } = fake();
    q.allow = 5n;
    const reset = await venue.prepare(spec);
    expect(reset.kind).toBe("approve_zero");
    expect(decodeFunctionData({ abi, data: reset.tx.data }).args?.[1]).toBe(0n);
    q.allow = 0n;
    const p = await venue.prepare(spec);
    expect(p.kind).toBe("approve");
    expect(p.tx.to).toBe(RH_USDG);
    expect(decodeFunctionData({ abi, data: p.tx.data }).args?.[1]).toBe(IN);
    mined(p, [approval(RH_USDG, IN)]);
    expect((await venue.reconcile(p, txHash)).status).toBe(
      "approval_confirmed",
    );
    mined(p, [approval(RH_USDG, IN + 1n)]);
    expect((await venue.reconcile(p, txHash)).status).toBe("unverified");
  });
  it("recovers missing wallet RPC ack by sender/nonce; pruned archive and replacements are handled", async () => {
    const { venue, q, mined } = fake(),
      p = await venue.prepare(spec);
    expect((await venue.reconcile(p)).status).toBe("pending");
    mined(p, logs(p, OUT));
    q.reply = false;
    expect((await venue.reconcile(p)).status).toBe("filled");
    q.archive = false;
    expect((await venue.reconcile(p, H(44))).status).toBe("filled");
    q.tx.input = "0x";
    expect((await venue.reconcile(p)).status).toBe("replaced");
  });
  it("holds unknown or forged/reorged evidence and accounts a reverted gas receipt", async () => {
    const { venue, q, mined } = fake(),
      p = await venue.prepare(spec);
    mined(p, logs(p, OUT));
    q.final = 10n;
    expect((await venue.reconcile(p, txHash)).status).toBe("pending");
    q.final = 11n;
    q.reorg = true;
    expect((await venue.reconcile(p, txHash)).status).toBe("pending");
    q.reorg = false;
    mined(p, [...logs(p, OUT), transfer(stock, owner, A(7), 1n)]);
    expect((await venue.reconcile(p, txHash)).status).toBe("unverified");
    mined(p, logs(p, OUT).slice(1));
    expect((await venue.reconcile(p, txHash)).status).toBe("unverified");
    mined(p, logs(p, OUT - OUT / 10n));
    expect((await venue.reconcile(p, txHash)).status).toBe("unverified");
    mined(p, [], "0x0");
    expect(await venue.reconcile(p, txHash)).toMatchObject({
      status: "failed",
      feeWei: "100000000000",
    });
  });
  it("can route through two verified WETH pools and validates both transfer legs", async () => {
    const { venue, q, mined } = fake();
    q.multi = true;
    const p = await venue.prepare(spec);
    expect(p.hops).toHaveLength(2);
    mined(p, logs(p, OUT));
    expect((await venue.reconcile(p)).status).toBe("filled");
    const bogus = logs(p, OUT);
    bogus.splice(4, 1);
    mined(p, bogus);
    expect((await venue.reconcile(p)).status).toBe("unverified");
  });
  it("supports verified stock sells and preserves amounts past JS integer precision", async () => {
    const { venue, q, mined } = fake();
    q.actual = IN;
    q.allow = OUT;
    const p = await venue.prepare({
      ...spec,
      side: "sell",
      amountIn: String(OUT),
    });
    expect(p.inputToken).toBe(stock);
    expect(p.outputToken).toBe(RH_USDG);
    mined(p, logs(p, IN));
    expect((await venue.reconcile(p)).amountIn).toBe(String(OUT));
  });
  it("rejects unavailable registry, code mismatch, unknown pools, stale oracle, reversed side and excess cost", async () => {
    for (const patch of [
      { badCode: true },
      { tamperPair: true },
      { stale: true },
      { wrongChain: true },
      { actual: OUT / 2n },
      { balance: 1n },
      { active: false },
      { badUid: true },
      { fee: 100000000000000n },
    ]) {
      const { venue, q } = fake();
      Object.assign(q, patch);
      await expect(venue.prepare(spec)).rejects.toThrow();
    }
    for (const patch of [
      { eligible: false },
      { symbol: "AAPL!" },
      { slippageBps: 500 },
      { amountIn: "1e8" },
      { maxFeeWei: "0" },
      { minOutput: (OUT + 1n).toString() },
    ])
      await expect(
        fake().venue.prepare({ ...spec, ...patch }),
      ).rejects.toThrow();
  });
  it("rejects changed nonce, corrupted terms, expiry or stale quote before returning signable bytes", async () => {
    const { venue, q } = fake(),
      p = await venue.prepare(spec);
    q.nonce++;
    await expect(venue.validate(p, true)).rejects.toThrow(/nonce/);
    q.nonce--;
    await expect(
      venue.validate({ ...p, termsHash: H(5) }, true),
    ).rejects.toThrow(/terms/);
    q.stale = true;
    await expect(venue.validate(p, true)).rejects.toThrow(/oracle/i);
    q.stale = false;
    q.now = p.expiresAt;
    await expect(venue.validate(p, true)).rejects.toThrow(/expired/);
  });
});
describe("Robinhood wallet workflow driver", () => {
  const m = {
    symbol: "AAPL",
    id: "robinhood:token:" + stock,
    name: "Apple",
    address: stock,
    venue: "robinhood" as const,
    kind: "token" as const,
  };
  const binding: WalletBudget = {
    network: "robinhood-mainnet",
    wallet: owner,
    settlementAsset: RH_USDG,
    decimals: 6,
    allocations: [
      { asset: RH_USDG, units: String(IN) },
      { asset: "ETH", units: spec.maxFeeWei },
    ],
    maxFeesPerOrder: [{ asset: "ETH", units: spec.maxFeeWei }],
  };
  const a: Action = {
    id: "stage-1",
    owner: "user-a",
    network: "robinhood-mainnet",
    programId: "program",
    strategyId: "strategy",
    version: 1,
    sequence: 1,
    stage: "enter",
    wallet: owner,
    instrument: m,
    side: "buy",
    leg: "entry",
    leverage: 1,
    slippageBps: 50,
    spendAsset: RH_USDG,
    spendUnits: String(IN),
    reduceOnly: false,
    exitReason: null,
  };
  it("creates only a wallet dispatch claim for a validated exact nonce and reconciles the real fill", async () => {
    const { q, venue, mined } = fake();
    let eligible = true;
    const d = robinhoodLiveDriver(venue, {
      eligible: async () => eligible,
      linked: async () => true,
      feeCap: async () => spec.maxFeeWei,
    });
    expect(
      await d.readiness(binding, m, { side: "buy", leverage: 1 } as never),
    ).toBeNull();
    const balance = await d.balance(binding, {
      id: "p",
      owner: "user-a",
      orders: {},
    } as LiveProgram);
    expect(balance.lossUsd6).toBe("0");
    expect(balance.free.map((a) => a.asset)).toContain("ETH");
    const t = await d.prepare(a),
      p = t.payload as unknown as RhPrepared;
    await expect(d.seal(a, t, { kind: "delegate" })).rejects.toThrow(
      /owner-wallet/,
    );
    const packet = await d.seal(a, t, {
      kind: "wallet",
      value: { authorizeWalletSubmission: true },
    });
    expect(packet.delivery).toBe("wallet");
    expect(packet.packet).toEqual(p.tx);
    expect(packet.recoveryId).toContain(":" + p.nonce);
    await expect(d.broadcast(a, t, packet)).rejects.toThrow();
    expect(q.calls).not.toContain("eth_sendTransaction");
    eligible = false;
    await expect(
      d.seal(a, t, {
        kind: "wallet",
        value: { authorizeWalletSubmission: true },
      }),
    ).rejects.toThrow(/eligibility/);
    mined(p, logs(p, OUT));
    const ev = await d.reconcile(a, t, packet.recoveryId, [txHash]);
    expect(ev.fills[0].credits).toEqual([{ asset: stock, units: String(OUT) }]);
    expect(ev.holding?.averageEntryUsd).toBe(50);
    expect(ev.final?.outcome).toBe("filled");
  });
  it("derives the daily drawdown from actual settled stock units, venue liquidation value and ETH fees", async () => {
    const { q, venue, mined } = fake(),
      d = robinhoodLiveDriver(venue, {
        eligible: async () => true,
        linked: async () => true,
        feeCap: async () => spec.maxFeeWei,
      });
    const t = await d.prepare(a),
      p = t.payload as unknown as RhPrepared;
    mined(p, logs(p, OUT));
    const state = {
      id: "program",
      owner: a.owner,
      orders: {
        one: {
          action: a,
          terms: t,
          digest: "test",
          recoveryId: "rh:4663:" + owner + ":2",
          candidateHashes: [txHash],
        },
      },
    } as unknown as LiveProgram;
    q.actual = 96000000n;
    const sample = await d.balance(binding, state);
    expect(sample.lossUsd6).toBe("4000100"); // 4 USD price loss plus 100 micro-USD gas.
    q.balance = 1n;
    await expect(d.balance(binding, state)).rejects.toThrow(/loss/);
  });
  it("requests a separate approval without releasing an execution packet or dispatching funds", async () => {
    const { q, venue } = fake();
    q.allow = 0n;
    let approval: RhPrepared | undefined;
    const d = robinhoodLiveDriver(venue, {
      eligible: async () => true,
      linked: async () => true,
      feeCap: async () => spec.maxFeeWei,
      approval: async (_, p) => {
        approval = p;
      },
    });
    await expect(d.prepare(a)).rejects.toThrow(/allowance/);
    expect(approval?.kind).toBe("approve");
    expect(q.calls).not.toContain("eth_sendRawTransaction");
  });
  it("returns a current verified on-chain stock bid and declines a stale or mismatched mark", async () => {
    const { q, venue } = fake();
    q.actual = 500000n;
    expect(await venue.spotPrice("AAPL")).toMatchObject({
      price: 50,
      observedAt: T,
      address: stock,
      decimals: 18,
      synthetic: false,
    });
    q.actual = 900000n;
    await expect(venue.spotPrice("AAPL")).rejects.toThrow(/oracle/);
    const deployed = await venue.verifyDeployment();
    expect(deployed.chainId).toBe(4663);
  });
  it("resolves only unique active issuer deployments with exact normalized identity", () => {
    const row = {
      tokenSymbol: "AAPL",
      status: "ASSET_STATUS_ACTIVE",
      deployments: [{ chainId: 4663, contractAddress: stock }],
    };
    expect(robinhoodIssuerCandidate({ assets: [row] }, "aapl")).toMatchObject({
      id: "robinhood:token:" + stock,
      address: stock,
      source: "robinhood_registry",
    });
    expect(robinhoodIssuerCandidate({ assets: [row, row] }, "AAPL")).toBeNull();
    expect(
      robinhoodIssuerCandidate(
        { assets: [{ ...row, status: "ASSET_STATUS_INACTIVE" }] },
        "AAPL",
      ),
    ).toBeNull();
    expect(
      robinhoodIssuerCandidate(
        {
          assets: [
            {
              ...row,
              deployments: [{ chainId: 46630, contractAddress: stock }],
            },
          ],
        },
        "AAPL",
      ),
    ).toBeNull();
  });
});
