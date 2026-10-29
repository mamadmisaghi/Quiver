# Sites intake preview gate — 2026-10-29

**PASS for the owner-private mock preview only. Backend/mainnet release remains blocked.**

Source: restored web 39ace33 + uncommitted supplied changes; backend e502d27 retained.

- Production Vinext build passes and enumerates 28 routes.
- Frontend typecheck passes. Original backend typecheck passes.
- Browser: landing renders supplied branding and motion; Open app navigates to builder; 9-node demo draft renders; Run backtest returns the sample metrics; Paper-trade navigates to run view; Stop -> confirmation -> Stopped; strategy list -> guest-readable strategy detail renders title, thesis, graph and rules; Fork to edit shows saved draft confirmation, with nothing running.
- Browser logs: only extension metadata warnings observed, no application error observed in these flows.
- Original contracts fixture checks pass; 38 extension fixture files are current.
- Full backend tests: 539 passed, 5 failed, 9 skipped. Four failures in m421 TLS transport and one in m513 pinned local RPC, with certificate errors/timeouts. Backend not deployed by this gate.
- Solidity/anvil and real provider integration not verified. Mobile performance/accessibility audit has not been repeated in this environment.

Known preview limits: original mock adapter, fixture data and browser-memory mutations; no real AI, backend engine service, persistent account data or real trades. Existing mock inconsistencies remain (e.g. a risk banner can stay visible after a stopped fixture run; different fixture result names). These do not block visual review but must not be represented as live trading behavior.

Changes limited to hosting configuration, ESM compatibility, a type-only DOM declaration repair, and recovery of missing image assets. No requested product redesign performed.

Rollback: select a previously saved Site version once one exists; this is the first standalone version, with no changes to the prior VPS.
