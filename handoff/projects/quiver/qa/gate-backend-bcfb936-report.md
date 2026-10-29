# Gate: backend bcfb936 (M4.9.2 769c738 + M5.0 bcfb936). Verdict: PASS

All times are Asia/Tehran, 2026-10-28. Fresh copy: /tmp/robin-gbcfbe (git archive of bcfb936 + foundry/lib). Probe file: qa/poc/robin-gbcf.test.ts.

## Standard checks
| Check | Result |
|---|---|
| vitest | 387/387 (47 files) |
| tsc, fixtures:check, lint | all 0 |
| npm audit | 0 vulnerabilities |
| forge | 54/54 |
| diff 485da53..bcfb936 | 16 files; reviewed |

## M4.9.2
| Check | Result |
|---|---|
| Cold-day overshoot: 12 concurrent, real cost $0.40, cap $1, default estimate | 2 AI calls, $0.80 spent, max 2 in flight, all 200; a 2nd burst made 0 calls. Within cap. PASS |
| 422 instruct does not burn a compile | 6 refused instructs (strategy_invalid / unsupported_prompt) → compilesUsedToday 0; then compile 200, instruct 201, 201, 4th 429 compile_quota_exceeded. PASS (10/min instruct rate limit still applies, as designed) |
| Late flatten | stop_and_flatten with a 200 ms quote delay vs 40 ms cap: positions/fills/cash unchanged, blockedFills=1, no events after stop. Plain stop during hung tick: no change. PASS |
| New knobs | LLM_EST_CALL_USD default 0.5 with $0.50 floor; LLM_MAX_OUTPUT_TOKENS 4000 sent as max_tokens; LLM_MAX_INPUT_TOKENS 16000; LLM_MAX_INFLIGHT 4 (overflow → demo compiler, "busy") |

## M5.0 chain reader
| Check | Result |
|---|---|
| Allowlist | Only eth_chainId, eth_blockNumber, eth_getCode, eth_getBalance, eth_call, eth_getBlockByNumber |
| Refused before network (capturing RPC) | 35 bad methods incl. sends, eth_sendRawTransaction, signing, wallet_*, anvil_*, hardhat_*, debug_*, eth_getLogs, eth_estimateGas, viem sendRawTransaction: 0 hits. PASS |
| Name tricks | case, whitespace, NUL/zero-width, comma-joined, __proto__/constructor/toString, empty, arrays/objects/null/1 (batch shapes): all refused, 0 hits. status() sends single requests only. PASS |
| Chain id mismatch | Node reporting 4663: chainIdMatches false; account() throws ChainMismatch with no getBalance. PASS |
| Timeouts | Hung RPC: status 402 ms, account 401 ms, both "unreachable". PASS |
| No SSRF | rpcUrl/rpc/url params, x-rpc-url, host, x-forwarded-host, PUT /me: 0 attacker hits. URL only from TESTNET_RPC_URL. PASS |
| Address validation | short/long/non-hex/no 0x/ENS/leading space/traversal → 422; 9 tokens 422; bad sessionKey 422. PASS |
| Auth | Both routes 401 without login, reads on or off. PASS |
| Default off | CHAIN_READS_ENABLED=false by default; accounts 503 venue_unavailable, no outbound traffic. PASS |
| Private keys | None in the diff. Only pre-existing in-memory mock signer key (sessionkeys/service.ts) and a .env.example placeholder the API never reads. PASS |

## Findings (none block)
- **Low**: `/chain/testnet/status` returns **200** `{reachable:false, reason:"Chain reads are off"}` when disabled, not 404/503 as the brief expected. Matches Sage's documented design; no traffic is sent.
- **Low**: bad EIP-55 checksum addresses are accepted (200) and echoed unnormalised. Suggest `getAddress()` and return the checksummed form, or 422 on a mixed-case mismatch.
- **Low**: `blockedFills` is only a field on the executor; not logged, evented or exposed as a metric.
