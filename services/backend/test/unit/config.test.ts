import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "../../src/config";
describe("config", () => {
  it("mock boots with empty env; empty strings are unset", () => {
    const c = loadConfig({ QUIVR_MODE: "mock", OPENROUTER_API_KEY: "", PORT: "" });
    expect(c.QUIVR_MODE).toBe("mock"); expect(c.OPENROUTER_API_KEY).toBeUndefined(); expect(c.PORT).toBe(8787);
  });
  it("strips inline comments", () => { expect(loadConfig({ QUIVR_MODE: "mock", PORT: "9000 # dev" }).PORT).toBe(9000); });
  it("mainnet fails closed without required keys", () => { expect(() => loadConfig({ QUIVR_MODE: "mainnet" })).toThrow(ConfigError); });
  it("testnet requires a JWT secret", () => { expect(() => loadConfig({ QUIVR_MODE: "testnet" })).toThrow(ConfigError); });
  it("describeConfig masks secrets", () => {
    const c = loadConfig({ QUIVR_MODE: "mock", OPENROUTER_API_KEY: "sk-or-supersecretvalue123" });
    expect(JSON.stringify(describeConfig(c))).not.toContain("supersecret");
  });
});
