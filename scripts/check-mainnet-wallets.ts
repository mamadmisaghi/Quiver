import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { encode } from "@msgpack/msgpack";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  base58,
  signSolanaQuote,
  signSolanaOwnership,
  injectedPhantom,
  type SwapChallenge,
} from "../lib/wallet/live-solana";
import {
  inspectHyperliquidGrant,
  signHyperliquidOwner,
  sendRobinhoodEOA,
  type EvmProvider,
  type EvmSigner,
  type RobinhoodReview,
} from "../lib/wallet/live-evm";
import {
  inspectHlOwnerOrder,
  signHlOwnerOrder,
  signHlRevoke,
  type HlOwnerTerms,
} from "../lib/wallet/live-hl-owner";
const { privateKey, publicKey } = generateKeyPairSync("ed25519"),
  pub = new Uint8Array(
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ),
  owner = base58(pub);
const note = (msg: Uint8Array) => new Uint8Array(sign(null, msg, privateKey));
function transaction(v0: boolean) {
  const data = Uint8Array.from([
    ...(v0 ? [128] : []),
    1,
    0,
    1,
    2,
    ...pub,
    ...Array(32).fill(2),
    ...Array(32).fill(4),
    1,
    1,
    1,
    0,
    1,
    7,
    ...(v0 ? [0] : []),
  ]);
  const unsigned = Uint8Array.from([1, ...Array(64).fill(0), ...data]);
  const quote: SwapChallenge = {
    network: "solana:mainnet",
    wallet: owner,
    transaction: Buffer.from(unsigned).toString("base64"),
    messageHash: createHash("sha256").update(data).digest("hex"),
    expiresAt: Date.now() + 10000,
  };
  const signed = unsigned.slice();
  signed.set(note(data), 1);
  return { data, unsigned, quote, signed };
}
for (const version of [false, true])
  test(
    "preserves every byte, signer, txid and account of " +
      (version ? "v0" : "legacy") +
      " transaction",
    async () => {
      const { quote, unsigned, signed } = transaction(version);
      let calls = 0;
      const signer = {
        address: owner,
        connectedAddress: () => owner,
        sign: async (bytes: Uint8Array, chain: string) => {
          calls++;
          assert.equal(chain, "solana:mainnet");
          assert.deepEqual(bytes, unsigned);
          return signed;
        },
      };
      const approved = await signSolanaQuote(signer, quote);
      assert.equal(approved.signed, Buffer.from(signed).toString("base64"));
      assert.equal(approved.txid, base58(signed.slice(1, 65)));
      assert.equal(calls, 1);
      await assert.rejects(
        signSolanaQuote({ ...signer, connectedAddress: () => "wrong" }, quote),
        /Select the quoted/,
      );
      await assert.rejects(
        signSolanaQuote(signer, {
          ...quote,
          network: "solana:devnet" as never,
        }),
        /network/,
      );
      await assert.rejects(
        signSolanaQuote(signer, { ...quote, messageHash: "0".repeat(64) }),
        /differs/,
      );
      await assert.rejects(
        signSolanaQuote(signer, { ...quote, expiresAt: Date.now() - 1 }),
        /expired/,
      );
      assert.equal(calls, 1);
      const changed = signed.slice();
      changed[changed.length - 2] ^= 1;
      await assert.rejects(
        signSolanaQuote({ ...signer, sign: async () => changed }, quote),
      );
      const sig = signed.slice();
      sig[3] ^= 1;
      await assert.rejects(
        signSolanaQuote({ ...signer, sign: async () => sig }, quote),
        /signature/,
      );
      let changedAcct = false;
      await assert.rejects(
        signSolanaQuote(
          {
            ...signer,
            connectedAddress: () => (changedAcct ? "else" : owner),
            sign: async () => {
              changedAcct = true;
              return signed;
            },
          },
          quote,
        ),
        /changed/,
      );
    },
  );
test("rejects multiple/sponsored signers and trailing instructions before prompting", async () => {
  const { quote, unsigned } = transaction(true);
  const signer = {
    address: owner,
    connectedAddress: () => owner,
    sign: async () => {
      throw Error("WALLET MUST NOT OPEN");
    },
  };
  for (const mutated of [
    Uint8Array.from([2, ...unsigned.slice(1)]),
    Uint8Array.from([...unsigned, 0]),
    Uint8Array.from([...unsigned.slice(0, 65), 129, ...unsigned.slice(66)]),
  ]) {
    await assert.rejects(
      signSolanaQuote(signer, {
        ...quote,
        transaction: Buffer.from(mutated).toString("base64"),
      }),
      (e) => e instanceof Error && !e.message.includes("WALLET MUST NOT OPEN"),
    );
  }
});
test("Phantom only signs the requested message, never broadcasts, and proves membership without a transaction", async () => {
  const { data, quote, signed } = transaction(true),
    origin = "https://example.test",
    nonce = "A".repeat(32),
    now = Date.now(),
    exp = now + 120000;
  const challenge = [
    new URL(origin).host + " wants you to link this Solana account to Quiver:",
    owner,
    "",
    "Prove ownership of this wallet. This signature links it to your Quiver account.",
    "",
    "URI: " + origin,
    "Version: 1",
    "Account: user_a",
    "Nonce: " + nonce,
    "Issued At: " + new Date(now).toISOString(),
    "Expiration Time: " + new Date(exp).toISOString(),
  ].join("\n");
  const methods: string[] = [];
  const pubkey = { toString: () => owner };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin },
      phantom: {
        solana: {
          isPhantom: true,
          publicKey: pubkey,
          connect: async () => ({ publicKey: pubkey }),
          signMessage: async (m: Uint8Array) => ({ signature: note(m) }),
          request: async ({
            method,
            params,
          }: {
            method: string;
            params: { message: string };
          }) => {
            methods.push(method);
            assert.equal(params.message, base58(data));
            return {
              signature: base58(signed.slice(1, 65)),
              publicKey: pubkey,
            };
          },
        },
      },
    },
  });
  const ph = await injectedPhantom();
  assert.equal(
    (await signSolanaQuote(ph, quote)).signed,
    Buffer.from(signed).toString("base64"),
  );
  assert.deepEqual(methods, ["signTransaction"]);
  assert.equal(
    await signSolanaOwnership(ph, owner, challenge, nonce, origin),
    base58(note(new TextEncoder().encode(challenge))),
  );
  await assert.rejects(
    signSolanaOwnership(
      ph,
      owner,
      challenge + "\nApprove $1000",
      nonce,
      origin,
    ),
  );
  delete (globalThis as any).window;
});
const master = "0x" + "cd".repeat(20),
  agent = "0x" + "ab".repeat(20),
  zero = "0x" + "0".repeat(40),
  validSig = "0x" + "01".repeat(64) + "1b";
const f = (name: string, type: string) => ({ name, type });
const domainFields = [
    f("name", "string"),
    f("version", "string"),
    f("chainId", "uint256"),
    f("verifyingContract", "address"),
  ],
  grantFields = [
    f("hyperliquidChain", "string"),
    f("agentAddress", "address"),
    f("agentName", "string"),
    f("nonce", "uint64"),
  ];
function grant(network: "mainnet" | "testnet" = "mainnet", nonce = Date.now()) {
  const primaryType = "HyperliquidTransaction:ApproveAgent";
  return {
    network,
    agent,
    master,
    typedData: {
      domain: {
        name: "HyperliquidSignTransaction",
        version: "1",
        chainId: network === "mainnet" ? 42161 : 421614,
        verifyingContract: zero,
      },
      types: { EIP712Domain: domainFields, [primaryType]: grantFields },
      primaryType,
      message: {
        hyperliquidChain: network === "mainnet" ? "Mainnet" : "Testnet",
        agentAddress: agent,
        agentName: "Quiver01 valid_until " + (nonce + 86400000),
        nonce: String(nonce),
      },
    },
  };
}
test("validates the exchange grant before touching the wallet and rejects cross-network/substituted grants", () => {
  assert.equal(inspectHyperliquidGrant(grant()).chainId, 42161);
  assert.equal(inspectHyperliquidGrant(grant("testnet")).chainId, 421614);
  const g = grant();
  assert.throws(() => inspectHyperliquidGrant({ ...g, network: "testnet" }));
  assert.throws(() => inspectHyperliquidGrant({ ...g, agent: master }));
  const bad = structuredClone(g);
  bad.typedData.message.agentName = "x";
  assert.throws(() => inspectHyperliquidGrant(bad));
  const expanded = structuredClone(g);
  expanded.typedData.types["HyperliquidTransaction:ApproveAgent"].push({
    name: "token",
    type: "address",
  });
  assert.throws(() => inspectHyperliquidGrant(expanded));
  assert.throws(() => inspectHyperliquidGrant({ ...g, slotName: "fake" }));
  assert.throws(() =>
    inspectHyperliquidGrant(grant("mainnet", Date.now() - 190000)),
  );
});
test("reacquires the Privy provider after switch and refuses wallet changes after a signature", async () => {
  let chain = "0x1",
    selected = master,
    reads = 0,
    count = 0;
  const provider = (): EvmProvider => {
    const originalNetwork = chain;
    return {
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return originalNetwork;
        if (method === "eth_accounts") return [selected];
        if (method === "eth_signTypedData_v4") {
          count++;
          assert.equal(params?.[0], master);
          assert.equal(JSON.parse(params![1] as string).domain.chainId, 42161);
          return validSig;
        }
        throw Error(method);
      },
    };
  };
  const signer: EvmSigner = {
    address: master,
    getProvider: async () => {
      reads++;
      return provider();
    },
    switchChain: async (id) => {
      chain = "0x" + id.toString(16);
    },
  };
  assert.equal(await signHyperliquidOwner(signer, grant()), validSig);
  assert.equal(reads, 2);
  assert.equal(count, 1);
  selected = agent;
  await assert.rejects(signHyperliquidOwner(signer, grant()), /owner/);
  assert.equal(count, 1);
  selected = master;
  const p = provider();
  const changing = {
    address: master,
    getProvider: async () => ({
      request: async (r: Parameters<EvmProvider["request"]>[0]) => {
        const out = await p.request(r);
        if (r.method === "eth_signTypedData_v4") selected = agent;
        return out;
      },
    }),
  };
  await assert.rejects(signHyperliquidOwner(changing, grant()), /owner/);
});
function l1terms(): HlOwnerTerms {
  const now = Date.now(),
    cloid = "0x" + "aa".repeat(16),
    order = {
      type: "order",
      orders: [
        {
          a: 0,
          b: true,
          p: "100",
          s: "0.25",
          r: false,
          t: { limit: { tif: "Ioc" } },
          c: cloid,
        },
      ],
      grouping: "na",
    },
    leverage = {
      type: "updateLeverage",
      asset: 0,
      isCross: false,
      leverage: 2,
    };
  const ownerSignatures = [leverage, order].map((action, i) => {
    const nonce = now + i,
      expiry = now + 10000;
    const a = Buffer.from(encode(action)),
      n = Buffer.alloc(8),
      e = Buffer.alloc(8);
    n.writeBigUInt64BE(BigInt(nonce));
    e.writeBigUInt64BE(BigInt(expiry));
    const c = Buffer.from(
      keccak_256(Buffer.concat([a, n, Buffer.alloc(2), e])),
    );
    return {
      op: (i ? "order" : "leverage") as "order" | "leverage",
      action,
      nonce,
      expiresAfter: expiry,
      typedData: {
        domain: {
          chainId: 1337,
          name: "Exchange",
          version: "1",
          verifyingContract: zero,
        },
        types: {
          Agent: [f("source", "string"), f("connectionId", "bytes32")],
          EIP712Domain: domainFields,
        },
        primaryType: "Agent",
        message: { source: "a", connectionId: "0x" + c.toString("hex") },
      },
    };
  });
  return {
    kind: "hyperliquid-perp-v1",
    network: "hyperliquid-mainnet",
    wallet: master,
    instrument: "hl:perp:BTC",
    market: { symbol: "BTC", asset: 0, szDecimals: 4, maxLeverage: 40 },
    leg: "entry",
    side: "B",
    leverage: 2,
    quantity: "0.25",
    limit: "100",
    cloid,
    marginUsd6: "12500000",
    feeCapUsd6: "12500",
    ownerSignatures,
  };
}
test("rebuilds both monetary owner L1 hashes and signs exact terms while staying on Arbitrum", async () => {
  const t = l1terms(),
    methods: string[] = [],
    p: EvmProvider = {
      request: async ({ method, params }) => {
        methods.push(method);
        if (method === "eth_chainId") return "0xa4b1";
        if (method === "eth_accounts") return [master];
        if (method === "eth_signTypedData_v4") {
          assert.equal(JSON.parse(params![1] as string).domain.chainId, 1337);
          return validSig;
        }
        throw Error(method);
      },
    };
  assert.deepEqual(
    (
      await signHlOwnerOrder(
        { address: master, getProvider: async () => p },
        t,
        master,
      )
    ).value.signatures,
    [validSig, validSig],
  );
  assert(!methods.some((m) => m.includes("switch")));
  assert.throws(() => inspectHlOwnerOrder({ ...t, limit: "101" }, master));
  assert.throws(() => inspectHlOwnerOrder({ ...t, marginUsd6: "1" }, master));
  assert.throws(() =>
    inspectHlOwnerOrder({ ...t, instrument: "hl:perp:ETH" }, master),
  );
  const forged = structuredClone(t);
  (forged.ownerSignatures[0].typedData as any).message.connectionId =
    "0x" + "11".repeat(32);
  assert.throws(() => inspectHlOwnerOrder(forged, master));
  const extra = structuredClone(t);
  (extra.ownerSignatures[1].action as any).builder = { b: agent, f: 200 };
  assert.throws(() => inspectHlOwnerOrder(extra, master));
});
test("validates deterministic removal of a grant and fails a substituted replacement", async () => {
  const nonce = Date.now(),
    old = { agent, name: "Quiver01", nonce: nonce - 360000 },
    g = grant("mainnet", nonce);
  const prefix = [
      "Quiver agent deregistration v1",
      "mainnet",
      master,
      old.name,
      agent,
      String(old.nonce),
      String(nonce),
    ].join("|"),
    replacement =
      "0x" +
      Buffer.from(keccak_256(new TextEncoder().encode(prefix)))
        .toString("hex")
        .slice(-40);
  g.typedData.message.agentAddress = replacement;
  g.typedData.message.agentName = "Quiver01 valid_until " + (nonce + 60000);
  g.agent = replacement;
  const s = {
    address: master,
    getProvider: async () => ({
      request: async ({ method }: { method: string }) =>
        method === "eth_chainId"
          ? "0xa4b1"
          : method === "eth_accounts"
            ? [master]
            : validSig,
    }),
  };
  assert.equal(await signHlRevoke(s, g, old), validSig);
  await assert.rejects(signHlRevoke(s, { ...g, agent }, old), /replacement/);
});
const evmReview = (): RobinhoodReview => ({
  intentId: "proof",
  step: 1,
  expiresAt: Date.now() + 10000,
  owner: master,
  maxNetworkFeeWei: "1000000",
  tx: {
    chainId: "0x1237",
    from: master,
    to: agent,
    value: "0x0",
    data: "0x11223344",
    nonce: "0x2",
    gas: "0x5208",
    gasPrice: "0x2",
  },
});
test("RH pins nonce, wallet, network and max gas; transport ambiguities never re-send", async () => {
  let requests = 0,
    claimed = false;
  const out: string[] = [];
  const signer = {
    address: master,
    getProvider: async () => ({
      request: async ({
        method,
        params,
      }: Parameters<EvmProvider["request"]>[0]) => {
        if (method === "eth_chainId") return "0x1237";
        if (method === "eth_accounts") return [master];
        if (method === "eth_getTransactionCount") return "0x2";
        if (method === "eth_sendTransaction") {
          assert(claimed);
          requests++;
          assert.equal((params![0] as { nonce: string }).nonce, "0x2");
          throw Error("timeout after broadcast");
        }
        throw Error(method);
      },
    }),
  };
  const fence = {
    claim: async () => {
      if (claimed) return "already_claimed" as const;
      claimed = true;
      return "claimed" as const;
    },
    record: async (s: { state: string }) => {
      out.push(s.state);
    },
  };
  assert.equal(
    (await sendRobinhoodEOA(signer, evmReview(), fence)).state,
    "unknown",
  );
  assert.equal(
    (await sendRobinhoodEOA(signer, evmReview(), fence)).state,
    "unknown",
  );
  assert.equal(requests, 1);
  assert.deepEqual(out, ["unknown"]);
  await assert.rejects(
    sendRobinhoodEOA(signer, { ...evmReview(), maxNetworkFeeWei: "1" }, fence),
  );
});
test("RH retains known hash if receipt recording fails; distinct user rejection cannot create a fill", async () => {
  const make = (reply: () => unknown) => ({
    address: master,
    getProvider: async () => ({
      request: async ({ method }: { method: string }) =>
        method === "eth_chainId"
          ? "0x1237"
          : method === "eth_accounts"
            ? [master]
            : method === "eth_getTransactionCount"
              ? "0x2"
              : reply(),
    }),
  });
  const hash = "0x" + "01".repeat(32);
  assert.deepEqual(
    await sendRobinhoodEOA(
      make(() => hash),
      evmReview(),
      {
        claim: async () => "claimed",
        record: async () => {
          throw Error("lost acknowledgment");
        },
      },
    ),
    { state: "unknown", hash },
  );
  assert.deepEqual(
    await sendRobinhoodEOA(
      make(() => {
        throw Object.assign(Error("rejected"), { code: 4001 });
      }),
      evmReview(),
      { claim: async () => "claimed", record: async () => {} },
    ),
    { state: "rejected" },
  );
});
