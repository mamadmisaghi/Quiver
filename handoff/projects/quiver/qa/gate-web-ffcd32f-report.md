# Web gate ffcd32f (with 75b03b2, 7e50760) against backend bd0ec27. Verdict: FAIL (not deployed), superseded by 0e978a2

Robin, 2026-10-28 (Tehran time). **QUALITY.md does not exist** in /workspace/quiver/web, so there was nothing to check against it. Evidence is in web/shots/m5-1/m516-*.

PASS:
- audit 0, tsc 0, build 0, lint 0 errors (1 warning: unused `_r`, share-mock.ts:31).
- /r and /c (unknown or garbage token) return a real 404.
- No overflow. No DOM or API leaks (DIDs or private data), and no off-origin or mixed-content requests.
- Activity feed and profile feed render.
- Wallet link: off shows lw-unavailable; on shows lw-link.
- Plan with AI: Stop works. The timeout fires at 30.5 s with a calm message.
- Replay media resolves to same-origin `/v1/public/replays/*`; javascript: and data: URLs render nothing.
- "Using your RPC": run locally with a throwaway master key and a fake public host (rpc.robin-gate.example on a mock TLS RPC). PUT with a loopback URL returns 422, and the fake host returns 200. The UI shows "USING YOUR RPC" with a 1 ETH balance. The mock saw eth_chainId, blockNumber, getBalance and getCode. The URL never appears in the DOM.
- x-quiver-rpc can be read cross-origin (Access-Control-Expose-Headers).
- Lighthouse: / and /leaderboard score 95–100 in every category.
- Code review only: write-off focuses "Keep it"; channel states; lastError shows no tokens.

FAIL / findings (owner Wren):
- **Medium: `/u/@nobody_zz` returns HTTP 200** (soft 404). "Trader not found" is rendered client-side only, and proxy.ts matches only /r and /c. A real 404 was an explicit requirement.
- Low: axe label-content-name-mismatch on 7 nodes on /. This is fixed in 0e978a2.
- Low: 401/404 resource errors appear in the console.
- Partial: the abort-on-unmount check was covered by code review plus CancelledErrors seen, but the requestfailed count was 0.
