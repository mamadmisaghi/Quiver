import test from "node:test";
import assert from "node:assert/strict";
import {
  blueprintChecks,
  environmentChecks,
  apiChecks,
  siteChecks,
} from "./preflight.mjs";

const origin = "https://workspace.example";
const ed = "MCowBQYDK2VwAyEAjOiJqGUId+nUOeMIjp003jcckM0jag7qK3apKMIXiTk=";
const common = {
  NODE_ENV: "production",
  DEV_LOGIN_ENABLED: "false",
  QUIVR_DEV_PERSIST: "0",
  CORS_ORIGINS: origin,
  SIWE_ORIGIN: origin,
  LLM_DAILY_BUDGET_USD: "5",
};
const paper = {
  ...common,
  QUIVR_MODE: "mock",
  QUIVR_MAINNET_ENABLED: "false",
  PRICE_SOURCE: "mock",
};
const live = {
  ...common,
  QUIVR_MODE: "mainnet",
  QUIVR_MAINNET_ENABLED: "true",
  CHAIN_ID: "4663",
  LIVE_EXECUTION_PROFILE: "venue-wallets",
  PRICE_SOURCE: "mainnet-readonly",
  TERMS_VERSION: "live-controls-v1",
  QUIVER_EDGE_PUBLIC_KEY: ed,
};
const secrets = {
  DATABASE_URL: "postgresql://local:fixture@db.local/release",
  QUIVR_JWT_SECRET: "j".repeat(45),
  SECRETS_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"),
  OPS_TOKEN: "o".repeat(42),
  PRIVY_APP_ID: "test-app",
  PRIVY_APP_SECRET: "test-privy",
  OPENROUTER_API_KEY: "test-model",
};
const secretKinds = {
  QUIVR_JWT_SECRET: "generateValue: true",
  SECRETS_MASTER_KEY: "generateValue: true",
  OPS_TOKEN: "generateValue: true",
  PRIVY_APP_ID: "sync: false",
  PRIVY_APP_SECRET: "sync: false",
  OPENROUTER_API_KEY: "sync: false",
};
function blueprint(env) {
  const vars = Object.entries(env)
    .map(
      ([key, v]) =>
        "      - key: " + key + "\n        value: " + JSON.stringify(v),
    )
    .concat(
      Object.entries(secretKinds).map(
        ([key, method]) => "      - key: " + key + "\n        " + method,
      ),
    );
  return [
    "services:",
    "  - type: web",
    "    name: quiver-api",
    "    numInstances: 1",
    "    dockerContext: ./services/backend",
    "    healthCheckPath: /v1/ready",
    "    autoDeployTrigger: off",
    "    disk:",
    "      mountPath: /var/data/quiver",
    "      sizeGB: 1",
    "    envVars:",
    ...vars,
    "      - key: DATABASE_URL",
    "        fromDatabase:",
    "          name: quiver-db",
    "          property: connectionString",
    "databases:",
    "  - name: quiver-db",
    "    ipAllowList: []",
  ].join("\n");
}
const ok = (xs) => xs.every((x) => x.ok);
test("paper v14 and live v15 pass separately; flags cannot silently open paper", () => {
  for (const [profile, env] of [
    ["paper", paper],
    ["live", live],
  ]) {
    const spec = blueprintChecks(blueprint(env));
    assert.equal(spec.profile, profile);
    assert(ok(spec.checks));
    assert(
      ok(
        environmentChecks(
          { ...env, ...secrets },
          profile,
          profile === "live" ? ed : undefined,
        ),
      ),
    );
  }
  assert(
    !ok(
      environmentChecks(
        { ...paper, ...secrets, QUIVR_MAINNET_ENABLED: "true" },
        "paper",
      ),
    ),
  );
  assert(
    !ok(environmentChecks({ ...live, ...secrets, QUIVR_MODE: "mock" }, "live")),
  );
  assert(
    !ok(
      environmentChecks(
        { ...live, ...secrets, DEV_LOGIN_ENABLED: "true" },
        "live",
      ),
    ),
  );
});
test("unrelated services/databases and commented controls cannot satisfy rollout checks", () => {
  const v = blueprint(live);
  assert(
    !ok(
      blueprintChecks(
        v.replace("numInstances: 1", "numInstances: 2") + "\n# numInstances: 1",
      ).checks,
    ),
  );
  assert(
    !ok(
      blueprintChecks(
        v.replace(
          "name: quiver-db\n    ipAllowList",
          "name: different-resource\n    ipAllowList",
        ),
      ).checks,
    ),
  );
  assert(
    !ok(
      blueprintChecks(
        v.replace(
          "property: connectionString",
          "property: externalConnectionString",
        ),
      ).checks,
    ),
  );
  assert(
    !ok(
      blueprintChecks(v.replace("ipAllowList: []", "ipAllowList: [0.0.0.0/0]"))
        .checks,
    ),
  );
  assert(
    !ok(
      blueprintChecks(
        v.replace(
          "      - key: DATABASE_URL",
          "      - key: SECRETS_MASTER_KEY\n        value: literal\n      - key: DATABASE_URL",
        ),
      ).checks,
    ),
  );
  assert(!ok(blueprintChecks(v, { hasBackup: false }).checks));
});
test("secrets and network identity are redacted, origin lists support separate exact origins", () => {
  const e = { ...live, ...secrets };
  assert(
    ok(
      environmentChecks(
        { ...e, CORS_ORIGINS: "https://other.example," + origin },
        "live",
        ed,
      ),
    ),
  );
  for (const x of [
    { QUIVER_EDGE_PUBLIC_KEY: Buffer.alloc(44).toString("base64") },
    { SECRETS_MASTER_KEY: "not a key" },
    { TERMS_VERSION: "draft-1" },
    {
      SIWE_ORIGIN: "https://foo.example",
      CORS_ORIGINS: "https://foo.example.bad",
    },
    { CORS_ORIGINS: "*," + origin },
    { OPS_TOKEN: e.QUIVR_JWT_SECRET },
    { LLM_DAILY_BUDGET_USD: "100000" },
    { PRIVY_APP_SECRET: "" },
    { DATABASE_URL: "redis://cache" },
  ])
    assert(!ok(environmentChecks({ ...e, ...x }, "live", ed)));
  const output = JSON.stringify(environmentChecks(e, "live", ed));
  for (const value of Object.values(secrets)) assert(!output.includes(value));
});
test("external probe accepts only public endpoints on the selected origin, no auth, no redirect", async () => {
  const responses = {
    "/v1/ready": {
      ready: true,
      storage: "postgres",
      execution: "paper_and_mainnet",
    },
    "/v1/auth/config": {
      privy: { enabled: true, appId: "app" },
      devLogin: false,
    },
    "/v1/live/status": {
      enabled: true,
      network: "mainnet",
      venues: ["hyperliquid", "solana", "robinhood"],
    },
  };
  const calls = [];
  const fetcher = async (url, init) => {
    assert.equal(url.origin, origin);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.deepEqual(init.headers, { accept: "application/json" });
    calls.push(url.pathname);
    if (url.pathname === "/v1/live/account")
      return Response.json({}, { status: 401 });
    return Response.json(responses[url.pathname]);
  };
  assert(ok(await apiChecks(origin + "/v1", "live", fetcher)));
  assert.equal(calls.length, 4);
  assert(
    !ok(
      await apiChecks(origin, "live", async () =>
        Response.json({ ready: true, storage: "memory", devLogin: true }),
      ),
    ),
  );
  assert(
    !ok(
      await apiChecks(origin, "live", async (url, init) =>
        url.pathname === "/v1/live/account"
          ? Response.json({ wallet: "public" })
          : fetcher(url, init),
      ),
    ),
  );
  for (const value of [
    "http://x",
    "https://user:secret@host.local/v1",
    "https://any.local/?secret=x",
    "https://any.local/ops",
  ]) {
    assert(
      !ok(
        await apiChecks(value, "live", async () => {
          throw Error("must not fetch");
        }),
      ),
    );
  }
});

test("site proxy proves its trusted location before mainnet handoff", async () => {
  const fixture = (proof) => async (url, init) => {
    assert.equal(url.href, origin + "/v1/live/status");
    assert.equal(init.method, "GET");
    return Response.json({
      enabled: true,
      network: "mainnet",
      originVerified: proof,
    });
  };
  assert(ok(await siteChecks(origin, "live", fixture(true))));
  assert(!ok(await siteChecks(origin, "live", fixture(false))));
  assert(!ok(await siteChecks(origin + "/v1", "live", fixture(true))));
  let calls = 0;
  assert(
    ok(
      await siteChecks(origin, "live", async (url, init) =>
        ++calls === 1
          ? new Response(null, { status: 503 })
          : fixture(true)(url, init),
      ),
    ),
  );
  assert.equal(calls, 2);
});
