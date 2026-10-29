import { savePreviewDraft } from "./preview-drafts";
// MOCK adapter for contract v1.1 extensions, backed by Sage's ext.* fixtures (parsed, so drift fails loudly).
import * as C from "@/lib/contracts";
import equity from "./fixtures/ext/ext.run-equity.json";
import pubs from "./fixtures/ext/ext.public-strategies.json";
import pub3 from "./fixtures/ext/ext.public-strategy.json";
import pub1 from "./fixtures/ext/ext.public-strategy.1.json"; // MOCK: captured from Sage's seed (backend ab57b1b)
import pub2 from "./fixtures/ext/ext.public-strategy.2.json"; // MOCK: captured from Sage's seed (backend ab57b1b)

import { ApiErr } from "./types";
import traders from "./fixtures/ext/ext.traders.json";
import rewards from "./fixtures/ext/ext.rewards.json";
import revenue from "./fixtures/ext/ext.revenue.json";
import skills from "./fixtures/ext/ext.skills.json";
import landing from "./fixtures/ext/ext.landing.json"; // MOCK: v1.2 fixtures
import settings from "./fixtures/ext/ext.settings.json";
import stopAll from "./fixtures/ext/ext.stop-all.json";
import runCard from "./fixtures/ext/ext.run-card.json";
import type { QuiverApiExt, Run } from "./types";

export const mockExt = (run: (id: string) => Promise<Run>): QuiverApiExt => ({
  async equity(runId) { return C.EquitySeries.parse({ ...equity, runId }); },
  async publicStrategies(q = {}) {
    const p = C.PublicStrategiesRes.parse(pubs);
    return { ...p, items: p.items.filter((s) => !q.venue || s.venues.includes(q.venue)) };
  },
  async publicStrategy(id) {
    const d = [pub1, pub2, pub3].find((x) => x.id === id);
    if (!d) throw new ApiErr("not_found", "Strategy not found.", 404);
    return C.PublicStrategyDetail.parse(d);
  },
  async forkPublicStrategy(id) {
    const d = C.PublicStrategyDetail.parse([pub1, pub2, pub3].find((x) => x.id === id) ?? (() => { throw new ApiErr("not_found", "Strategy not found.", 404); })());
    // Preview forks persist as local drafts; no run is started.
    return savePreviewDraft(d.strategy, d.id);
  },
  async traders(window = "30d") { return C.LeaderboardRes.parse({ ...traders, window }); },
  async rewards() { return C.RewardsRes.parse(rewards); },
  async revenue() { return C.RevenueRes.parse(revenue); },
  async skills() { return C.SkillsRes.parse(skills).items; },
  resolveRun: run,
  // MOCK: v1.2 endpoints served from Sage's fixtures.
  async landing() { return C.LandingRes.parse(landing); },
  async settings() { return C.AccountSettingsRes.parse(settings); },
  async stopAll() { return C.StopAllRes.parse(stopAll); },
  async runCard() { return C.RunCard.parse(runCard); },
});
