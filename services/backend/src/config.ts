import { Config } from "../contracts/src/config";
export type { Config };

/** Load config from env. Empty strings are treated as unset (so a copied .env.example boots in mock mode). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    const t = v.replace(/\s+#.*$/, "").trim();
    if (t !== "") cleaned[k] = t;
  }
  const r = Config.safeParse(cleaned);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid configuration (failing closed):\n${lines.join("\n")}`, r.error.issues.map((i) => String(i.path[0])));
  }
  return r.data;
}
export class ConfigError extends Error {
  constructor(msg: string, public keys: string[]) { super(msg); }
}
/** Never log values; only report which keys are set. */
export function describeConfig(c: Config) {
  const secretish = /KEY|SECRET|JWT|TOKEN_?$|DATABASE_URL|REDIS_URL/;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, secretish.test(k) ? (v ? "set" : "unset") : v]));
}
