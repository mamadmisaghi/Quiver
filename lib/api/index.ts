// The one data entry point for screens. NEXT_PUBLIC_API_MODE=mock (default) | live.
import { liveApi } from "./live";
import { mockApi } from "./mock";
import type { QuiverApi } from "./types";
export let API_MODE: "live"|"mock" = process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";
// QA P2 LCP: NEXT_PUBLIC_API_MODE is inlined at build time, so live builds drop the mock (and its zod parses).
// eslint-disable-next-line @typescript-eslint/no-require-imports
export let api: QuiverApi = API_MODE === "live" ? liveApi : mockApi;
export function configureWorkspaceApi(connected:boolean){
  API_MODE=connected||process.env.NEXT_PUBLIC_API_MODE==="live"?"live":"mock";
  api=API_MODE==="live"?liveApi:mockApi;
}
export * from "./types";
export * from "./graph";
export * from "./format";
export * from "./demo";
