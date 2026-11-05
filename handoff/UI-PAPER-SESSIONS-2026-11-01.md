# Quiver interaction and paper-session refinement

The dark/amber identity, existing brand tokens, typography, landing structure and trading logic are preserved.

- Graphs use left-to-right topological columns at every viewport. Nodes stay readable at 200px; connector gaps are 61.6px (56px + 10%). Long dependency edges route above intervening columns. Pulses and accessible node popovers remain. Partial graphs also form in Signal → Trigger → Action → Exit order.
- Builder review groups exact markets/contracts, strategy budget, order amounts and repeat rules. Market details expand in place. Missing details continue to gate execution.
- Builder saves the strategy, creates a distinct browser-local paper session and navigates to `/app/run/paper_<id>`. Test workflow uses explicit synthetic frames; Run paper trade uses indicative quotes. There is no inline workflow lab in Builder.
- `/app/run` lists actual preview sessions; the old fixture run is available through an explicit sample link. Backend runs are listed in connected API mode.
- Session storage keeps an immutable strategy/version snapshot and separate checkpoints per session. Reload restores an existing quote session paused. Web Locks allow only one tab to drive a quote session; pause/navigation invalidates in-flight quote responses. Only the lock owner writes a paused checkpoint, before releasing its lock; closing an observer tab cannot overwrite the active driver's state. Closing or leaving the run page stops observation. Sessions remain browser-local even when a draft is synced online.
- Risk settings use two compact panels with inline editors. Enter saves, Escape cancels, focus returns to Edit. Existing optimistic-version checks remain. Editing saved limits does not mutate an earlier session snapshot.
- Settings groups notifications, connections and profile/activity into accessible disclosures. Shared cursors, focus, input and disabled states use existing brand tokens.

## Validation

- Frontend TypeScript check passed.
- 13 targeted checks: session isolation, frozen strategy snapshots, checkpoint round-trip, duplicate-fill prevention, incomplete-market gating, storage failures and horizontal graph topology.
- 21 preview integration checks passed.
- 22 Site storage/budget/authorization checks passed.
- Browser: NEET recurring buy configured with $1,000, launched from Builder into its own page and completed a labelled synthetic scenario; risk saved in place and Escape cancellation preserved saved value; Edit computed cursor is pointer.
- Published-site check: the selected NEET mint resolved to live indicative quotes and Run paper trade opened its own persisted session. No fill occurred while the price was above the user's threshold. A second tab was blocked from driving the same session.

## Preview boundaries

No real orders are enabled. Quote sessions require the page to remain open, and use modeled fees without gas, book slippage or perpetual funding costs. Render deployment, durable unattended workers and settlement ingestion remain separate infrastructure work.
