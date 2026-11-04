import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const base = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const check = (condition, label) => {
  console.log((condition ? "PASS " : "MISSING ") + label);
  if (!condition) process.exitCode = 1;
};
const blueprint = readFileSync(resolve(base, "render.yaml"), "utf8");
check(
  blueprint.includes("numInstances: 1") &&
    blueprint.includes("/var/data/quiver") &&
    blueprint.includes("fromDatabase:"),
  "Single-writer database and persistent replay disk",
);
check(
  blueprint.includes("healthCheckPath: /v1/ready") && blueprint.includes("autoDeployTrigger: off"),
  "Readiness probe and operator-controlled deployment",
);
check(
  existsSync(resolve(base, "services/backend/scripts/ops/database-backup.sh")),
  "Backup and recovery command",
);
const env = process.env;
if (process.argv.includes("--env")) {
  for (const n of [
    "DATABASE_URL",
    "QUIVR_JWT_SECRET",
    "SECRETS_MASTER_KEY",
    "PRIVY_APP_ID",
    "PRIVY_APP_SECRET",
    "OPENROUTER_API_KEY",
    "OPS_TOKEN",
  ])
    check(!!env[n], n);
  const master = env.SECRETS_MASTER_KEY ?? "";
  check(
    /^[0-9a-fA-F]{64}$/.test(master) ||
      (/^[A-Za-z0-9+/_-]{43}=?$/.test(master) && Buffer.from(master, "base64").length === 32),
    "32-byte encrypted vault key",
  );
  check(
    env.NODE_ENV === "production" &&
      env.DEV_LOGIN_ENABLED === "false" &&
      env.QUIVR_MAINNET_ENABLED === "false",
    "Production authentication and cash-trading gates",
  );
  check(
    env.SIWE_ORIGIN === env.CORS_ORIGINS && /^https:\/\//.test(env.SIWE_ORIGIN ?? ""),
    "Approved wallet and browser origin",
  );
  check(
    Number(env.LLM_DAILY_BUDGET_USD) > 0 && Number(env.LLM_DAILY_BUDGET_USD) <= 5,
    "Daily AI budget up to USD 5",
  );
}
const url = process.argv.find((a) => a.startsWith("--api="))?.slice(6);
if (url) {
  const base = new URL(url);
  if (base.protocol !== "https:" || base.username || base.password) throw Error("Use the HTTPS API origin.");
  for (const path of ["/v1/ready", "/v1/auth/config"]) {
    try {
      const res = await fetch(new URL(path, base), { redirect: "error", signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      check(
        res.ok &&
          (path.endsWith("ready")
            ? data.ready === true && data.storage === "postgres"
            : data.privy?.enabled === true && data.devLogin === false),
        path,
      );
    } catch {
      check(false, path);
    }
  }
}
