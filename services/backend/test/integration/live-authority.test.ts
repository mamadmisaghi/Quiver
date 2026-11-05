import { describe, expect, it } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as edSign,
} from "node:crypto";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  LiveAuthority,
  type LiveAccess,
} from "../../src/execution/live-authority";
import {
  HyperliquidVenue,
  approvalDigest,
  l1TypedData,
  revocationReplacement,
  type Grant,
} from "../../src/execution/hyperliquid-testnet";
import { SecretVault } from "../../src/secrets/vault";
import { verifiedEdgeCountry } from "../../src/execution/live-region";
import type { Action } from "../../src/execution/live-program";
import type { User } from "../../src/store";

const uid = "usr_authority",
  at = 1793800000000;
function fixture() {
  const owner = privateKeyToAccount(generatePrivateKey()),
    other = privateKeyToAccount(generatePrivateKey());
  const user = {
    id: uid,
    label: "privy:did:privy:verifieduser",
    linkedWallets: [{ address: owner.address, linkedAt: at }],
    solanaWallets: ["wallet1"],
    eligibility: {
      country: null,
      selfDeclaredNonUsPerson: false,
      stockTokens: "unknown",
      reason: "Not declared",
    },
  } as User;
  const store = {
    users: new Map([[uid, user]]),
    liveAccess: new Map<string, LiveAccess>(),
    executionAccounts: new Map<string, { paused?: boolean }>(),
  };
  let moment = at,
    enabled = true,
    postCount = 0,
    drop = false;
  let remote: { address: string; name: string; validUntil: number } | null =
    null;
  const snapshots: string[] = [];
  const venue = new HyperliquidVenue(
    "mainnet",
    async (url, opts) => {
      const req = JSON.parse(String(opts.body));
      if (url === "https://api.hyperliquid.xyz/exchange") {
        const g = store.liveAccess.get(uid)!.agent!;
        if (g.state === "checking")
          expect(JSON.parse(snapshots.at(-1)!).agent.state).toBe("checking");
        if (g.state === "disabled")
          expect(JSON.parse(snapshots.at(-1)!).agent.revokeAttempted).toBe(
            true,
          );
        expect(req.action.type).toBe("approveAgent");
        expect(req.action.hyperliquidChain).toBe("Mainnet");
        const [name, expiry] = String(req.action.agentName).split(
          " valid_until ",
        );
        remote = {
          name,
          validUntil: Number(expiry),
          address: req.action.agentAddress.toLowerCase(),
        };
        postCount++;
        if (drop) {
          drop = false;
          throw Error("dropped acknowledgement");
        }
        return Response.json({ status: "ok", response: { type: "default" } });
      }
      if (url !== "https://api.hyperliquid.xyz/info")
        throw Error("Unbound host");
      if (req.type === "userRole")
        return Response.json(
          remote?.address === req.user.toLowerCase()
            ? { role: "agent", data: { user: owner.address } }
            : { role: "missing" },
        );
      if (req.type === "extraAgents")
        return Response.json(remote ? [remote] : []);
      throw Error("Unsupported information request");
    },
    () => moment,
  );
  const auth = new LiveAuthority({
    store,
    venue,
    vault: new SecretVault(randomBytes(32).toString("hex")),
    enabled: () => enabled,
    now: () => moment,
    commit: async () => {
      snapshots.push(JSON.stringify(store.liveAccess.get(uid)));
    },
    terms: "live-controls-v1",
    blockedStocks: ["US", "GB"],
    blockedPerps: ["US"],
    maxDailyUsd: 1000,
  });
  const agreement = {
    version: "live-controls-v1",
    residence: "DE",
    acceptRealFunds: true as const,
    nonUs: true,
    limits: {
      maxOrderUsd: 123.000001,
      dailyUsd: 600,
      maxLeverage: 7,
      maxSlippageBps: 100,
    },
  };
  const enter = () => auth.agree(user, agreement, "DE");
  const signGrant = (g: Grant) =>
    owner.sign({ hash: approvalDigest(g, "mainnet") });
  return {
    auth,
    user,
    store,
    owner,
    other,
    venue,
    agreement,
    enter,
    signGrant,
    snapshots,
    posts: () => postCount,
    dropNext: () => {
      drop = true;
    },
    setTime: (n: number) => {
      moment = n;
    },
    setEnabled: (v: boolean) => {
      enabled = v;
    },
  };
}
const rawAction = (wallet: Address) =>
  ({
    owner: uid,
    network: "hyperliquid-mainnet",
    wallet,
    leg: "entry",
    reduceOnly: false,
    notionalUsd6: "123000001",
    spendUnits: "123000001",
    slippageBps: 75,
    leverage: 7,
  }) as Action;

describe("production live authority", () => {
  it("requires genuine verified ownership, a matching residence, current disclosures and valid denomination", () => {
    const f = fixture();
    expect(() => f.auth.agree(f.user, f.agreement, null)).toThrow(
      /verified network/,
    );
    expect(() =>
      f.auth.agree(f.user, { ...f.agreement, residence: "GB" }, "DE"),
    ).toThrow(/verified network/);
    expect(() =>
      f.auth.agree(f.user, { ...f.agreement, version: "old" }, "DE"),
    ).toThrow(/current/);
    expect(() =>
      f.auth.agree(
        f.user,
        { ...f.agreement, limits: { ...f.agreement.limits, dailyUsd: 1001 } },
        "DE",
      ),
    ).toThrow();
    expect(() =>
      f.auth.agree({ ...f.user, label: "dev:test" }, f.agreement, "DE"),
    ).toThrow(/verified production/);
    f.enter();
    const a = rawAction(f.owner.address);
    expect(f.auth.allow(uid, a)).toBe(true);
    expect(f.auth.allow(uid, { ...a, notionalUsd6: "123000002" })).toBe(false);
    expect(f.auth.allow(uid, { ...a, notionalUsd6: undefined })).toBe(false);
    expect(f.auth.allow(uid, { ...a, wallet: f.other.address })).toBe(false);
    expect(f.auth.allow(uid, { ...a, slippageBps: 101 })).toBe(false);
    expect(f.auth.allow(uid, { ...a, leverage: 8 })).toBe(false);
    f.auth.noteRegion(uid, "US");
    expect(f.auth.allow(uid, a)).toBe(false);
    f.auth.noteRegion(uid, "DE");
    f.auth.pause(f.user);
    expect(f.auth.allow(uid, { ...a, reduceOnly: true })).toBe(false);
    expect(
      f.auth.allow(uid, { ...a, leg: "exit", reduceOnly: true, leverage: 8 }),
    ).toBe(true);
    f.setTime(at + 8 * 86400000);
    expect(f.auth.eligible(uid, "hyperliquid-mainnet", true)).toBe(false);
  });
  it("durably consumes grants, rejects cross-network signatures, recovers a lost response, and verifies remote revocation", async () => {
    const f = fixture();
    f.enter();
    const c = f.auth.newGrant(f.user, f.owner.address, 4),
      g = f.store.liveAccess.get(uid)!.agent!;
    expect(c.typedData.domain.chainId).toBe(42161);
    expect(f.auth.newGrant(f.user, f.owner.address, 4).agent).toBe(c.agent);
    expect(() => f.auth.newGrant(f.user, f.owner.address, 25)).toThrow(/24/);
    expect(() => f.auth.newGrant(f.user, f.owner.address, 1)).toThrow(
      /pending grant/,
    );
    const wrong = await f.owner.sign({
      hash: approvalDigest(g.grant, "testnet"),
    });
    await expect(f.auth.activate(f.user, wrong)).rejects.toThrow(/signature/);
    expect(g.state).toBe("pending");
    expect(f.posts()).toBe(0);
    const ownerSig = await f.signGrant(g.grant);
    f.dropNext();
    await expect(f.auth.activate(f.user, ownerSig)).rejects.toThrow();
    expect(g.state).toBe("checking");
    expect(f.posts()).toBe(1);
    await f.auth.refreshGrant(f.user);
    expect(g.state).toBe("active");
    expect(f.posts()).toBe(1);
    await f.auth.activate(f.user, ownerSig);
    expect(f.posts()).toBe(1);
    expect(await f.auth.active(uid, f.owner.address)).toBe(true);
    const a = {
      type: "updateLeverage",
      asset: 0,
      isCross: false,
      leverage: 3,
    } as const;
    const env = await f.auth.sign(uid, f.owner.address, a, at + 14000);
    expect(env.signed.network).toBe("mainnet");
    expect(
      await recoverTypedDataAddress({
        ...l1TypedData(a, env.signed.nonce, env.signed.expiresAfter, "mainnet"),
        signature: env.signed.signature,
      }),
    ).toBe(c.agent);
    expect(JSON.parse(f.snapshots.at(-1)!).agent.lastNonce).toBe(
      env.signed.nonce,
    );
    expect(env.signed.nonce).toBeGreaterThanOrEqual(at);
    expect((f.auth.public(f.user).agent as any).sealed).toBeUndefined();
    expect(JSON.stringify(f.auth.public(f.user))).not.toContain(g.sealed);
    const challenge = f.auth.revokePrompt(f.user);
    if (!("typedData" in challenge) || !challenge.typedData)
      throw Error("Missing owner challenge");
    const rep = revocationReplacement(
      g.grant,
      f.owner.address,
      g.revokeNonce!,
      "mainnet",
    );
    expect(challenge.agent).toBe(rep.agent);
    expect(challenge.purpose).toBe("revoke");
    expect(g.sealed).toBe("");
    expect(g.state).toBe("disabled");
    await expect(
      f.auth.sign(uid, f.owner.address, a, at + 14000),
    ).rejects.toThrow(/inactive/);
    const sig = await f.owner.sign({ hash: approvalDigest(rep, "mainnet") });
    f.dropNext();
    await expect(f.auth.revoke(f.user, sig)).rejects.toThrow();
    expect(f.posts()).toBe(2);
    expect(g.revokeAttempted).toBe(true);
    await f.auth.revoke(f.user, sig);
    expect(g.state).toBe("revoked");
    expect(f.posts()).toBe(2);
  });
  it("reserves non-overlapping ranges across simultaneous owner prompts and rejects unauthorized chains", async () => {
    const f = fixture();
    f.enter();
    const g = f.auth.newGrant(f.user, f.owner.address, 1);
    const [n1, n2] = await Promise.all([
      f.auth.reserveOwnerNonces(uid, f.owner.address, 2),
      f.auth.reserveOwnerNonces(uid, f.owner.address, 2),
    ]);
    expect(n1).toBe(Number(g.typedData.message.nonce) + 1);
    expect(n2).toBe(n1 + 2);
    expect(
      JSON.parse(f.snapshots.at(-1)!).ownerNonces[
        f.owner.address.toLowerCase()
      ],
    ).toBe(n2 + 1);
    await expect(
      f.auth.reserveOwnerNonces(uid, f.other.address, 1),
    ).rejects.toThrow(/Link/);
    f.setEnabled(false);
    expect(f.auth.allow(uid, rawAction(f.owner.address))).toBe(false);
    expect(
      () =>
        new LiveAuthority({
          ...f.auth.d,
          venue: new HyperliquidVenue("testnet"),
        }),
    ).toThrow(/mainnet/);
  });
});
describe("signed geographic edge facts", () => {
  it("binds exact path, API method, site origin and current authenticated bearer; rejects forgery, stale proofs and replay", () => {
    const pair = generateKeyPairSync("ed25519"),
      key = pair.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
      method = "POST",
      reqPath = "/v1/live/consent?mode=live",
      origin = "https://quiver.example",
      token = "Bearer test-fixture",
      nonce = randomUUID();
    const auth = createHash("sha256").update(token).digest("base64");
    const data = [
      "quiver-origin-v1",
      origin,
      method,
      reqPath,
      String(at),
      nonce,
      "DE",
      auth,
    ].join("\n");
    const proof = [
      at,
      nonce,
      "DE",
      edSign(null, Buffer.from(data), pair.privateKey).toString("base64"),
    ].join(".");
    const request = (
      p = reqPath,
      t = token,
      value = proof,
      o = origin,
      m = method,
    ) =>
      new Request("https://api.example" + p, {
        method: m,
        headers: {
          authorization: t,
          origin: o,
          "x-quiver-origin-proof": value,
          "cf-ipcountry": "GB",
        },
      });
    expect(
      verifiedEdgeCountry(request(reqPath, "Bearer changed"), origin, key, at),
    ).toBeNull();
    expect(
      verifiedEdgeCountry(request("/different"), origin, key, at),
    ).toBeNull();
    expect(
      verifiedEdgeCountry(
        request(reqPath, token, proof, "https://other.example"),
        origin,
        key,
        at,
      ),
    ).toBeNull();
    expect(
      verifiedEdgeCountry(
        request(reqPath, token, proof, origin, "GET"),
        origin,
        key,
        at,
      ),
    ).toBeNull();
    expect(
      verifiedEdgeCountry(
        request(reqPath, token, proof.replace(".DE.", ".GB.")),
        origin,
        key,
        at,
      ),
    ).toBeNull();
    expect(
      verifiedEdgeCountry(request(reqPath, token, ""), origin, key, at),
    ).toBeNull();
    expect(verifiedEdgeCountry(request(), origin, key, at + 31000)).toBeNull();
    const req = request();
    expect(verifiedEdgeCountry(req, origin, key, at)).toBe("DE");
    expect(verifiedEdgeCountry(req, origin, key, at + 100)).toBe("DE");
    expect(verifiedEdgeCountry(request(), origin, key, at + 100)).toBeNull();
  });
});
