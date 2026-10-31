# Strategy intent and editing — 2026-10-31

This release fixes the reported NEET-to-NVDA substitution, unrelated refinement drafts, Risk navigation, disconnected graph nodes and clipped node details. It adds reviewable multi-stage workflow drafts. It does not activate continuous execution or real orders.

## Behavior

- AI extracts a typed workflow, grounded in source text. Deterministic checks preserve named assets, amounts, leverage and condition values; an independent AI audit checks the complete meaning before a result is accepted. Invalid AI output returns an explicit error instead of falling back to an unrelated demo.
- The exact recurring-buy grammar in the reported example works without AI. NEET, $0.003, $100 and one minute are preserved. The user supplies the strategy budget and chooses whether to recheck the condition every purchase or latch it once.
- Public, bounded metadata lookups resolve Solana tokens (DEX Screener), active Hyperliquid contracts and leverage limits, and Polymarket questions/outcomes/deadlines. Same-name Solana mints and Polymarket events require explicit selection. Robinhood stock catalog entries remain labeled preview routing; no real broker connection is implied.
- Typed dependencies distinguish fills, closed positions, realized trading profit and resolved event profit. Profit funding references source stages. Complex workflows remain reviewable drafts and are rejected by the execution engine until their adapters and scheduler exist.
- Exact local refinements preserve the original strategy and add the requested risk or take-profit change. A standalone edit without context asks the user to open a strategy instead of inventing an instrument. Failed edits preserve the current draft.
- Risk limits edit inline with Save/Cancel, strategy version checks and durable preview storage. Active-run edits are disabled in the UI. Online updates use owner-scoped compare-and-swap; stale uploads cannot overwrite newer drafts.
- Graphs are derived from actual references/dependencies. Unused legacy signals are omitted, including cached graphs loaded from old drafts. Nodes open keyboard/touch-accessible detail popovers.
- Simulated take-profit ladders sell fractions of the original position, once per rung, including after checkpoint restore. Deferred reducing orders cannot reopen a reversed position after another exit fills.

## Verification

- Backend: 531 passed, 9 skipped across 83 test files; two network fixture files (m421 and m513) excluded because their required transport is unavailable in this environment.
- Includes 25 new strategy-intent tests for parsing, grounding, market identity, AI audit failures, dependency graphs, edits, execution guards and partial exits.
- Preview integration checks: 21 passed. Site storage checks: 19 passed, including stale-version and insert-only protections.
- Frontend and backend TypeScript checks passed. Backend bundle built.
- Browser QA: exact NEET example preserved its asset/price/amount/interval; budget and repeat behavior updated the graph; node details opened; saving worked. Risk max position changed from 25% to 80% inline, advanced the same draft version and survived reload.
- Local preview could not reach the public market lookup endpoints. Resolver behavior has injected-response tests; production lookup must be verified after publication.
- Authenticated paid AI calls were not exercised in this browser session. Model integration paths are covered with test doubles; arbitrary-language accuracy is not guaranteed.

## Remaining before continuous production use

1. Fund and provision the agreed Render services, durable database and always-on worker.
2. Complete and verify the execution adapters, scheduling, real price feeds and accounting for recurring and cross-venue workflows. Hyperliquid metadata lookup is not a trading connector; Polymarket plans are not submitted bets.
3. Connect provider credentials through secret storage, confirm selected instruments and validate real market data end to end.
4. Run continuous paper-trading acceptance tests, restart/recovery tests and operational monitoring before enabling live orders.

No VPS changes, paid infrastructure creation or real financial orders were performed in this release. Existing public Site audience is preserved. GitHub changes stay on the existing review branch/PR and are not merged to main.
