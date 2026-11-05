import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
  createPublicKey,
  verify,
} from "node:crypto";
import { decodeWire, encode58, read58 } from "../../src/execution/solana-wire";
import {
  CPMM,
  CP_IDL,
  SPL,
  SOLANA_GENESIS,
  associated,
  makeFundingBundle,
  prepareDirect,
  verifyUnsigned,
  verifySigned,
  finalizedDirect,
  bindSetup,
  broadcastExact,
  type SwapScope,
} from "../../src/execution/raydium-scoped-swap";
import {
  PrivySpotSigner,
  type PrivySpotGrant,
} from "../../src/execution/privy-spot-signer";
import { privySpotStore } from "../../src/execution/privy-spot-routes";
import {
  withPrivySpot,
  SPOT_USDC,
} from "../../src/execution/privy-spot-driver";
import type { Action, Driver } from "../../src/execution/live-program";
import { SecretVault } from "../../src/secrets/vault";
const pair = () => {
  const p = generateKeyPairSync("ed25519");
  return {
    key: p.privateKey,
    address: encode58(
      p.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
    ),
  };
};
const owner = pair(),
  exec = pair(),
  out = pair().address,
  pool = pair().address,
  head = pair().address,
  other = pair().address;
const uid = "user-a",
  did = "did:privy:reference123",
  wid = "embedded-wallet",
  strategyId = "stg_fixture",
  stageId = "buy_second",
  now = Date.now();
const system = "11111111111111111111111111111111";
const s: SwapScope = {
  fundingOwner: owner.address,
  executor: exec.address,
  pool,
  inputMint: SPOT_USDC,
  outputMint: out,
  inputAccount: associated(owner.address, SPOT_USDC),
  outputAccount: associated(owner.address, out),
  unitsPerOrder: "1000000",
  minimumOutputUnits: "990000",
  totalInputUnits: "2000000",
  feeCapLamports: "8000",
  expiresAt: now + 600000,
};
const acct = (owner: string, data: Buffer, lamports = 2000000) => ({
  owner,
  data: [data.toString("base64"), "base64"],
  lamports,
  executable: false,
});
const token = (mint: string, units: bigint, delegated = false) => {
  const b = Buffer.alloc(165);
  read58(mint, 32).copy(b);
  read58(owner.address, 32).copy(b, 32);
  b.writeBigUInt64LE(units, 64);
  b[108] = 1;
  if (delegated) {
    b.writeUInt32LE(1, 72);
    read58(exec.address, 32).copy(b, 76);
    b.writeBigUInt64LE(2000000n, 121);
  }
  return acct(SPL, b);
};
const mint = () => {
  const m = Buffer.alloc(82);
  m[44] = 6;
  m[45] = 1;
  return acct(SPL, m);
};
const data = Buffer.alloc(741);
Buffer.from([247, 237, 227, 245, 215, 195, 222, 70]).copy(data);
for (const [i, key] of [
  pair().address,
  pair().address,
  pair().address,
  pair().address,
  pair().address,
  SPOT_USDC,
  out,
  SPL,
  SPL,
  pair().address,
].entries())
  read58(key, 32).copy(data, 8 + 32 * i);
data[328] = 255;
let activated = false,
  created = false,
  fullEvidence = true,
  mutation = false,
  wrongGenesis = false,
  failure = false,
  wrongFee = false,
  noSettle = false;
let packet = "",
  txid = "",
  sent = 0,
  simulations = 0;
const funds = () => [
  acct(system, Buffer.alloc(0), 200000),
  token(SPOT_USDC, 5000000n, activated),
  token(out, 0n),
];
const accounts = (keys: string[]) =>
  keys.map((a) =>
    a === pool
      ? acct(CPMM, data)
      : a === s.inputAccount
        ? funds()[1]
        : a === s.outputAccount
          ? created
            ? funds()[2]
            : null
          : a === SPOT_USDC || a === out
            ? mint()
            : a === exec.address
              ? funds()[0]
              : null,
  );
const signatures = (unsigned: string, key: typeof owner.key) => {
  const b = Buffer.from(unsigned, "base64");
  sign(null, decodeWire(unsigned).message, key).copy(b, 1);
  return b.toString("base64");
};
const proof = (wire: string) => {
  const t = decodeWire(wire);
  const pre = t.accountKeys.map((_v, i) => (i === 0 ? 200000 : 2000)),
    post = [...pre];
  post[0] -= 5000;
  const tok = (mint: string, account: string, n: string) => ({
    mint,
    owner: owner.address,
    programId: SPL,
    accountIndex: t.accountKeys.indexOf(account),
    uiTokenAmount: { amount: n },
  });
  return {
    err: null,
    fee: wrongFee ? 5001 : 5000,
    preBalances: pre,
    postBalances: post,
    preTokenBalances: [
      tok(SPOT_USDC, s.inputAccount, "5000000"),
      tok(out, s.outputAccount, "0"),
    ],
    postTokenBalances: [
      tok(SPOT_USDC, s.inputAccount, "4000000"),
      tok(out, s.outputAccount, "1000000"),
    ],
  };
};
const status = { slot: 102, confirmationStatus: "finalized", err: null };
async function json(method: string, params: unknown[]): Promise<any> {
  if (method === "getGenesisHash")
    return wrongGenesis ? "devnet" : SOLANA_GENESIS;
  if (method === "getLatestBlockhash")
    return {
      context: { slot: 100 },
      value: { blockhash: head, lastValidBlockHeight: 110 },
    };
  if (method === "getBlockHeight") return 100;
  if (method === "getMinimumBalanceForRentExemption") return 2039280;
  if (method === "getBalance") return { value: 200000 };
  if (method === "getMultipleAccounts")
    return { context: { slot: 100 }, value: accounts(params[0] as string[]) };
  if (method === "getFeeForMessage")
    return { context: { slot: 100 }, value: 5000 };
  if (method === "simulateTransaction") {
    simulations++;
    const wire = params[0] as string;
    const opts = params[1] as { sigVerify: boolean };
    if (opts.sigVerify)
      assert(!decodeWire(wire).signatures[0].equals(Buffer.alloc(64)));
    const evidence = proof(wire);
    const a = acct(system, Buffer.alloc(0), 195000);
    return {
      context: { slot: 100 },
      value: fullEvidence
        ? evidence
        : {
            err: null,
            accounts: [
              a,
              token(SPOT_USDC, 4000000n, true),
              token(out, 1000000n),
            ],
          },
    };
  }
  if (method === "sendTransaction") {
    sent++;
    packet = params[0] as string;
    txid = encode58(decodeWire(packet).signatures[0]);
    if (decodeWire(packet).programs.includes(SPL)) {
      activated = true;
      created = true;
    }
    if (failure) throw Error("unconfirmed");
    return txid;
  }
  if (method === "getSignatureStatuses")
    return { context: { slot: 102 }, value: [noSettle ? null : status] };
  if (method === "getTransaction")
    return {
      slot: 102,
      blockTime: Math.floor(now / 1000),
      transaction: [packet, "base64"],
      meta: decodeWire(packet).programs.includes(CPMM)
        ? proof(packet)
        : { err: null, fee: 5000 },
    };
  throw Error("Unexpected RPC method " + method);
}
const rpc = <T>(m: string, p: unknown[]) => json(m, p) as Promise<T>;
const records = new Map<string, PrivySpotGrant>();
let saves = 0;
const store = privySpotStore(
  records,
  async () => {
    saves++;
  },
  () => true,
);
let signerPub = "",
  policy: any,
  attached = false,
  extra = false,
  userChanged = false;
let signedCount = 0;
const canonical = (x: any): string =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x !== null && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const http = async (input: any, init?: RequestInit) => {
  const url = String(input),
    { pathname: path } = new URL(url);
  assert(url.startsWith("https://api.privy.io/v1/"));
  const headers = new Headers(init?.headers),
    body = init?.body && JSON.parse(String(init.body));
  assert.equal(headers.get("privy-app-id"), "test-app");
  const linked = [
    {
      id: wid,
      type: "wallet",
      address: exec.address,
      chain_type: "solana",
      wallet_client_type: "privy",
      connector_type: "embedded",
      user_can_sign: true,
    },
    { type: "wallet", address: owner.address, chain_type: "solana" },
  ];
  let val: unknown;
  if (path.startsWith("/v1/users/"))
    val = { id: userChanged ? "other" : did, linked_accounts: linked };
  else if (path === "/v1/wallets/" + wid)
    val = {
      id: wid,
      chain_type: "solana",
      address: exec.address,
      owner_id: "owner-quorum",
      archived_at: null,
      policy_ids: [],
      additional_signers: attached
        ? [
            {
              signer_id: "trade-quorum",
              override_policy_ids: extra ? [] : ["owner-policy"],
            },
          ]
        : [],
    };
  else if (path === "/v1/key_quorums/owner-quorum")
    val = {
      id: "owner-quorum",
      authorization_threshold: 1,
      authorization_keys: [],
      user_ids: [did],
      key_quorum_ids: [],
    };
  else if (path === "/v1/key_quorums" && init?.method === "POST") {
    signerPub = body.public_keys[0];
    assert.equal(body.authorization_threshold, 1);
    val = { id: "trade-quorum" };
  } else if (path === "/v1/key_quorums/trade-quorum")
    val = {
      id: "trade-quorum",
      authorization_threshold: 1,
      authorization_keys: [{ public_key: signerPub }],
      user_ids: null,
    };
  else if (path === "/v1/policies" && init?.method === "POST") {
    policy = body;
    val = { id: "owner-policy" };
  } else if (path === "/v1/policies/owner-policy") {
    val = {
      ...policy,
      id: "owner-policy",
      rules: mutation
        ? []
        : policy.rules.map((r: any) => ({ ...r, id: "generated-rule" })),
    };
  } else if (path === "/v1/wallets/" + wid + "/rpc") {
    const h = Object.fromEntries(
      ["privy-app-id", "privy-idempotency-key", "privy-request-expiry"].map(
        (k) => [k, headers.get(k)],
      ),
    );
    assert(
      verify(
        "sha256",
        Buffer.from(
          canonical({ version: 1, method: "POST", url, headers: h, body }),
        ),
        createPublicKey({
          key: Buffer.from(signerPub, "base64"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(headers.get("privy-authorization-signature")!, "base64"),
      ),
    );
    assert([...records.values()][0].ops.length > 0);
    signedCount++;
    val = {
      method: "signTransaction",
      data: {
        encoding: "base64",
        signed_transaction: signatures(body.params.transaction, exec.key),
      },
    };
  } else throw Error("Unexpected Privy endpoint " + path);
  return Response.json(val);
};
const opts = {
  appId: "test-app",
  appSecret: "example",
  vault: new SecretVault("10".repeat(32)),
  store,
  rpc,
  fetch: http as typeof fetch,
  now: () => now,
};
const signer = new PrivySpotSigner(opts);
const plan = { strategyId, version: 1, stages: [{ stageId, scope: s }] },
  user = { ownerId: uid, did, walletId: wid };
assert.throws(() => associated("ab", out));
const offered = await signer.offer(user, plan);
assert.equal(offered.signers[0].policyIds[0], "owner-policy");
assert.equal(policy.owner_id, "owner-quorum");
assert.equal(policy.rules.length, 1);
assert.equal(policy.rules[0].conditions[1].value, CPMM);
assert.equal(CP_IDL.instructions[0].args[1].name, "minimum_amount_out");
assert(!JSON.stringify(offered).includes("sealed"));
await assert.rejects(signer.activate("other", offered.id));
await assert.rejects(
  signer.prepareSetup(uid, offered.id, "approve"),
  /consent/,
);
attached = true;
const setup = await signer.prepareSetup(uid, offered.id, "approve");
const approved = signatures(setup.unsigned!, owner.key);
assert.deepEqual(decodeWire(approved).programs, [
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  SPL,
]);
await assert.rejects(
  signer.submitSetup(
    uid,
    offered.id,
    setup.id,
    signatures(setup.unsigned!, exec.key),
  ),
  /different setup/,
);
noSettle = true;
failure = true;
const delivered = await signer.submitSetup(uid, offered.id, setup.id, approved);
assert.equal(delivered.state, "attempted");
assert.equal(sent, 1);
await signer.submitSetup(uid, offered.id, setup.id, approved);
assert.equal(sent, 1);
noSettle = false;
failure = false;
await signer.checkSetup(uid, offered.id, setup.id);
await signer.activate(uid, offered.id);
assert.equal(records.get(offered.id)!.status, "active");
let pin = await prepareDirect(s, rpc, 50, now, "990001");
assert.equal(pin.minimumOut, "995000");
assert.equal(pin.fee, "5000");
assert.equal(pin.expectedOut, "1000000");
assert(decodeWire(pin.unsigned).programs.length === 1);
await assert.rejects(
  verifyUnsigned({ ...pin, minimumOut: "1" }, rpc, now),
  /Pinned/,
);
wrongFee = true;
await assert.rejects(verifyUnsigned(pin, rpc, now), /fee/);
wrongFee = false;
fullEvidence = false;
await verifyUnsigned(pin, rpc, now);
fullEvidence = true;
wrongGenesis = true;
await assert.rejects(prepareDirect(s, rpc, 50, now), /cluster/);
wrongGenesis = false;
const markets = {
  [SPOT_USDC]: { usd: 1, decimals: 6 },
  [out]: { usd: 1, decimals: 6 },
};
const fallback: Driver = {
  prepare: async () => {
    throw Error("fallback used");
  },
  readiness: async () => null,
  balance: async () => ({
    network: "solana-mainnet",
    wallet: s.fundingOwner,
    settlementAsset: SPOT_USDC,
    decimals: 6,
    free: [],
    lossUsd6: "0",
    observedAt: now,
  }),
  seal: async () => {
    throw Error();
  },
  broadcast: async () => {},
  reconcile: async () => {
    throw Error();
  },
  delegated: async () => false,
};
const d = withPrivySpot(fallback, {
  signer,
  grants: () => [...records.values()],
  rpc,
  linked: () => true,
  marks: async () => markets,
  mode: async () => "auto",
  now: () => now,
});
const a: Action = {
  owner: uid,
  id: "intent-trade-1",
  programId: "live-oneshot",
  strategyId,
  version: 1,
  stage: stageId,
  sequence: 0,
  network: "solana-mainnet",
  wallet: owner.address,
  instrument: {
    id: "sol:token:" + out,
    symbol: "ASSET",
    address: out,
    venue: "solana",
    kind: "token",
  },
  leg: "entry",
  side: "buy",
  leverage: 1,
  slippageBps: 50,
  spendAsset: SPOT_USDC,
  spendUnits: "1000000",
  reduceOnly: false,
  exitReason: null,
};
assert.equal(await d.delegated(a), true);
assert.equal(await d.delegated({ ...a, version: 2 }), false);
const terms = await d.prepare(a);
extra = true;
await assert.rejects(d.seal(a, terms, { kind: "delegate" }), /consent/);
extra = false;
mutation = true;
await assert.rejects(d.seal(a, terms, { kind: "delegate" }), /policy differs/);
mutation = false;
userChanged = true;
await assert.rejects(d.seal(a, terms, { kind: "delegate" }), /embedded wallet/);
userChanged = false;
await assert.rejects(
  d.seal(a, terms, { kind: "wallet", value: "anything" }),
  /Delegated/,
);
const signed = await d.seal(a, terms, { kind: "delegate" });
assert.equal(
  (await signer.soleProviderSigner(uid, offered.id)).removeAllSafe,
  true,
);
assert.equal(records.get(offered.id)!.programId, "live-oneshot");
await d.broadcast(a, terms, signed);
const receipt = await d.reconcile(a, terms, signed.recoveryId);
assert.equal(receipt.holding?.quantity, "1000000");
assert.equal(receipt.holding?.quantityDecimals, 6);
assert.equal(receipt.fills[0].debits[1].units, "5000");
assert.equal(receipt.final?.outcome, "filled");
const second = { ...a, id: "intent-trade-2" };
await d.seal(second, await d.prepare(second), { kind: "delegate" });
const third = { ...a, id: "intent-trade-3" };
await assert.rejects(
  d.seal(third, await d.prepare(third), { kind: "delegate" }),
  /remaining budget/,
);
await signer.disable(uid, offered.id);
assert.equal(records.get(offered.id)!.sealed, "");
assert.equal(await d.delegated(a), false);
await assert.rejects(d.broadcast(a, terms, signed), /revoked/);
assert.equal(
  (await d.reconcile(a, terms, signed.recoveryId)).final!.outcome,
  "filled",
);
const revoke = await signer.prepareSetup(uid, offered.id, "revoke");
assert.deepEqual(decodeWire(revoke.unsigned!).programs, [SPL]);
assert(signedCount === 2 && saves >= 10 && simulations >= 15);
console.log(
  "PASS Privy user ownership, exact signer policy, dual owner consent, write-ahead setup and lost-response recheck",
);
console.log(
  "PASS canonical mainnet CP swap, caps and floors, standard and expanded simulation, signed bytes and finalized receipts",
);
console.log(
  "PASS program binding, durable lifetime cap, policy substitution, separate funding and executor, local revocation and post-revoke reconciliation",
);
