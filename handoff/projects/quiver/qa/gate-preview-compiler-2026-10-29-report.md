# Prompt-specific preview compiler and draft workflow gate

Scope: preview frontend/API only. Mainnet remains disabled; no paid provider calls or wallet transactions.

- Replaced fixed mock compile output with the existing backend deterministic compiler behind bounded POST /api/preview/compile (24 KB request limit, CompileReq validation, streamed typed events).
- Refine and image requests refuse clearly until their actual AI integration is configured. No silent unrelated strategy fallback.
- Draft saving/forking uses browser-local records; edit links reopen that record. Saves never start a custom run.
- Changed descriptions cannot save or run the old graph. Example backtest data is explicitly labelled; custom run button and mock API refuse custom execution until the engine is connected.
- Compiler integration checks: 8 passed. Tested NVDA amount/threshold/graph, ETH instrument/amount/3x/graph with no NVDA nodes, scheduled BTC, unknown prompt, invalid body, oversized body, truthful refine refusal, draft content persistence.
- Frontend TypeScript passed during implementation; final TypeScript/build rerun is part of publication packaging.
- Browser local preview: ETH $400 / 3x / RSI<30 / stop5% produced 5 nodes and matching plain-language rules, rather than the old 9-node NVDA/Fed sample. Saving showed Saved and View drafts.
- Found local HTTP preview lacks crypto.randomUUID; corrected to the existing randomHex compatibility helper and repeated save successfully. This is an identifier, never a secret or signer key.
- Preview daemon initially served stale source (Link missing). Restarted supported preview once after verifying file exists; no application code changed to work around infrastructure.
- No independent detector/Lighthouse/physical mobile score claimed. Historical backend suite results unchanged (539 pass, 5 fail, 9 skip); not a backend production release gate.
- Post-publication acceptance: draft a different ticker, verify matching graph, save/reload/reopen that draft, check changed-text save guard and unsupported prompt, and inspect application console. Publication status and browser evidence determine delivery.
