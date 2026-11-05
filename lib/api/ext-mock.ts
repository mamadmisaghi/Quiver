// MOCK adapter for contract v1.1 extensions, backed by Sage's ext.* fixtures (parsed, so drift fails loudly).
import * as C from "@/lib/contracts";
import equity from "./fixtures/ext/ext.run-equity.json";

import { ApiErr } from "./types";
import revenue from "./fixtures/ext/ext.revenue.json";
import skills from "./fixtures/ext/ext.skills.json";
import landing from "./fixtures/ext/ext.landing.json"; // MOCK: v1.2 fixtures
import settings from "./fixtures/ext/ext.settings.json";
import stopAll from "./fixtures/ext/ext.stop-all.json";
import runCard from "./fixtures/ext/ext.run-card.json";
import type { QuiverApiExt, Run } from "./types";

export const mockExt = (run: (id: string) => Promise<Run>): QuiverApiExt => ({
  async equity(runId) { return C.EquitySeries.parse({ ...equity, runId }); },
  async publicStrategies() { return { items: [], nextCursor: null }; },
  async publicStrategy() { throw new ApiErr("not_found", "This strategy has not been published.", 404); },
  async forkPublicStrategy() { throw new ApiErr("not_found", "This strategy has not been published.", 404); },
  async traders(window = "30d") { return { window, basis: "paper", items: [], asOf: new Date().toISOString(), mock: false, notice: "" }; },
  async rewards() {
    const now = new Date().toISOString();
    return { mock: true, example: true, notice: "", points: 0, rank: 0, totalParticipants: 0,
      season: { id: "inactive", name: "", startsAt: now, endsAt: now }, quests: [], history: [] };
  },
  async revenue() { return C.RevenueRes.parse({ ...revenue, notice: "" }); },
  async skills() { return C.SkillsRes.parse(skills).items; },
  resolveRun: run,
  // MOCK: v1.2 endpoints served from Sage's fixtures.
  async landing() { return C.LandingRes.parse({ ...landing, preview: null, featured: [], notice: "" }); },
  async settings() { return C.AccountSettingsRes.parse(settings); },
  async stopAll() { return C.StopAllRes.parse(stopAll); },
  async runCard() { return C.RunCard.parse(runCard); },
});
