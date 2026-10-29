// M5.27: build Foundry artifacts ONCE before any test file runs. Several anvil files ran `forge build` concurrently,
// racing on foundry/out (a reader could see a half-written artifact JSON).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BIN } from "./anvil";
export default function setup() { if (existsSync(join(BIN, "forge"))) execFileSync(join(BIN, "forge"), ["build", "--root", "foundry"], { stdio: "ignore" }); }
