import { build } from "esbuild";
await build({ entryPoints: ["src/main.ts"], outfile: "dist/main.js", bundle: true, platform: "node", target: "node24", format: "esm", packages: "external", sourcemap: true });
