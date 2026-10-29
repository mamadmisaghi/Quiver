// MOCK M5.5/M5.10 profiles, follow and paper-only copy (in-memory, deterministic). Mirrors the server's rules:
// copy needs a follow first (403 details.handle), one copy per source (409), unfollow detaches copies, sync 403 detached|not_following.
import * as C from "@/lib/contracts";
import { ApiErr, type QuiverSocialApi, type CopyView } from "./types";
const ME = "@you";
const PEOPLE: Record<string, { displayName: string | null; bio: string | null; strategies: { id: string; name: string; venues: string[]; forks: number; paperReturn30dPct: string | null }[] }> = {
  "@demo_marco": { displayName: "Marco", bio: "Macro-event trader. Paper only.", strategies: [{ id: "stg_demo0000000000000000000003", name: "Fed cut + NVDA dip", venues: ["robinhood", "hyperliquid", "polymarket"], forks: 0, paperReturn30dPct: "0.81" }] },
  // Ids, names and numbers match ext.public-strategies.json / Sage's seed, so profile → /app/strategies/:id resolves.
  "@demo_lena": { displayName: "Lena", bio: null, strategies: [{ id: "stg_demo0000000000000000000001", name: "BTC oversold bounce", venues: ["hyperliquid"], forks: 0, paperReturn30dPct: "0.06" }] },
  "@demo_okafor": { displayName: "Okafor", bio: null, strategies: [{ id: "stg_demo0000000000000000000002", name: "ETH trend follow", venues: ["hyperliquid"], forks: 0, paperReturn30dPct: "0.01" }] },
  "@trader_3f9a0c1d": { displayName: null, bio: null, strategies: [] }, // limited profile (no public strategies)
};
/** Handles the mock profile endpoint knows (used by proxy.ts to 404 unknown /u/<handle> in mock mode). */
export const MOCK_PROFILE_HANDLES: readonly string[] = [ME, ...Object.keys(PEOPLE)];
let me = { displayName: null as string | null, bio: null as string | null };
const following = new Set<string>(["@demo_lena"]);
const copies: CopyView[] = [];
const T0 = "2026-10-27T15:46:00.000Z";
const view = (h: string) => {
  if (h === ME) return C.Profile.parse({ handle: ME, ...me, isYou: true, isFollowing: false, demo: false, limited: false, followers: 0, following: following.size, strategies: [], bestPaperReturn30dPct: null });
  const p = PEOPLE[h]; if (!p) throw new ApiErr("not_found", "Profile not found.", 404);
  const limited = p.strategies.length === 0;
  return C.Profile.parse({ handle: h, displayName: limited ? null : p.displayName, bio: limited ? null : p.bio, isYou: false, isFollowing: following.has(h), demo: h.startsWith("@demo_"), limited,
    followers: following.has(h) ? 1 : 0, following: limited ? null : 3, strategies: p.strategies.map((s) => ({ ...s, publishedAt: T0 })), bestPaperReturn30dPct: p.strategies[0]?.paperReturn30dPct ?? null });
};
const fr = (h: string, on: boolean) => C.FollowRes.parse({ handle: h, following: on, followers: on ? 1 : 0 });
export const mockSocial: QuiverSocialApi = {
  // MOCK M5.17 search: traders + public strategies from PEOPLE, a few registry markets.
  async search(q, limit = 6) {
    const t = q.trim().toLowerCase(); if (!t || t.length > 80) throw new ApiErr("validation_failed", "Search needs 1–80 characters.", 422);
    const hit = (x: string) => x.toLowerCase().includes(t);
    const mk = [{ id: "hl:BTC-PERP", symbol: "BTC-PERP", name: "Bitcoin perpetual", venue: "hyperliquid", assetClass: "crypto" }, { id: "hl:ETH-PERP", symbol: "ETH-PERP", name: "Ether perpetual", venue: "hyperliquid", assetClass: "crypto" }, { id: "rh:TSLA", symbol: "TSLA", name: "Tesla stock token", venue: "robinhood", assetClass: "stock" }];
    const ppl = Object.entries(PEOPLE).filter(([, p]) => p.strategies.length);
    return C.SearchRes.parse({ // M5.20: q is not echoed
      markets: mk.filter((m) => hit(m.symbol) || hit(m.name)).slice(0, limit),
      strategies: ppl.flatMap(([h, p]) => p.strategies.filter((s) => hit(s.name)).map((s) => ({ publicStrategyId: s.id, name: s.name, handle: h }))).slice(0, limit),
      traders: t.length < 2 ? [] : ppl.filter(([h]) => hit(h)).map(([h, p]) => ({ handle: h, strategies: p.strategies.length, isYou: h === ME })).slice(0, limit) });
  },
  // MOCK M5.12 activity feed: derived from the in-memory follow + copy state above; cursor = index.
  async activity({ scope = "all", handle, cursor, limit = 20 }) {
    if (handle) { // MOCK M5.16 public trader activity
      const p = PEOPLE[handle]; if (!p) throw new ApiErr("not_found", "Trader not found.", 404);
      const items = p.strategies.map((st, k) => ({ id: `pub.${st.id}.1`, kind: "strategy_published" as const, at: new Date(Date.parse(T0) - (90 + k * 600) * 60_000).toISOString(), actor: { handle, isYou: handle === ME }, strategy: { publicStrategyId: st.id, name: st.name, version: 1 }, run: null }));
      return C.ActivityRes.parse({ items, nextCursor: null, limited: items.length === 0 && handle !== ME });
    }
    const at = (m: number) => new Date(Date.parse(T0) - m * 60_000).toISOString();
    const pub = [...following].flatMap((h) => (PEOPLE[h]?.strategies ?? []).map((st, k) => ({ id: `act_pub_${h}_${k}`, kind: "strategy_published" as const, at: at(90 + k * 600), actor: { handle: h, isYou: false }, strategy: { publicStrategyId: st.id, name: st.name, version: 1 }, run: null })));
    const mine = [
      ...copies.flatMap((cp, k) => [{ id: `act_cp_${k}`, kind: "copy_started" as const, at: cp.copiedAt, actor: { handle: ME, isYou: true }, strategy: { publicStrategyId: cp.publicStrategyId, name: cp.sourceName, version: cp.sourceVersion }, run: null }]),
      { id: "act_run_1", kind: "run_started" as const, at: at(30), actor: { handle: ME, isYou: true }, strategy: { publicStrategyId: null, name: "My NVDA dip test", version: 2 }, run: { runId: "run_01M5Z0VQ20DV23P9NYMM", mode: "paper" as const, status: "running" } },
      { id: "act_run_0", kind: "run_stopped" as const, at: at(1500), actor: { handle: ME, isYou: true }, strategy: { publicStrategyId: null, name: "SOL funding flip (fork)", version: 1 }, run: { runId: "run_01M5Z0VQ20DV23P9NYMM", mode: "paper" as const, status: "stopped" } },
    ];
    const all = (scope === "following" ? pub : scope === "mine" ? mine : [...pub, ...mine]).sort((a, b) => b.at.localeCompare(a.at));
    const from = cursor ? Number(cursor) || all.length : 0; const items = all.slice(from, from + limit);
    return C.ActivityRes.parse({ items, nextCursor: from + limit < all.length ? String(from + limit) : null });
  },
  async profile(h) { return view(h); },
  async myProfile() { return view(ME); },
  async putMyProfile(b) { if (b.displayName !== undefined) me.displayName = b.displayName || null; if (b.bio !== undefined) me.bio = b.bio || null; me = { ...me }; return view(ME); },
  async follow(h) { view(h); if (h === ME) throw new ApiErr("validation_failed", "You can't follow yourself.", 422); following.add(h); return fr(h, true); },
  async unfollow(h) { following.delete(h); copies.forEach((c, i) => { if (c.sourceHandle === h && !c.detached) copies[i] = { ...c, detached: true, detachedAt: new Date().toISOString(), runStatus: "stopped" }; }); return fr(h, false); },
  async following() { return C.FollowingRes.parse({ items: [...following].map((h) => ({ handle: h, displayName: PEOPLE[h]?.strategies.length ? PEOPLE[h].displayName : null, strategies: PEOPLE[h]?.strategies.length ?? 0 })) }); },
  async copy(b) {
    const src = Object.entries(PEOPLE).find(([, p]) => p.strategies.some((s) => s.id === b.publicStrategyId));
    if (!src) throw new ApiErr("not_found", "Strategy not found.", 404);
    const [h, p] = src; const s = p.strategies.find((x) => x.id === b.publicStrategyId)!;
    if (!following.has(h)) throw new ApiErr("forbidden", `Follow ${h} first to copy their strategies.`, 403, { handle: h });
    if (copies.some((c) => c.publicStrategyId === s.id && !c.detached)) throw new ApiErr("conflict", "You already copy this strategy. Sync it instead.", 409);
    const now = new Date().toISOString();
    const c = C.CopyView.parse({ strategyId: `stg_01M6COPY${String(copies.length).padStart(12, "0")}`, publicStrategyId: s.id, sourceHandle: h, sourceName: s.name, sourceVersion: 1, latestSourceVersion: 2, behind: true, detached: false, detachedAt: null, mode: "paper", runId: "run_01M5YZQ3600JK49MXYGF", runStatus: "running", copiedAt: now, syncedAt: now });
    copies.unshift(c); return c;
  },
  async copies() { return C.CopyListRes.parse({ items: copies, notice: "Copy-trading is paper only: it mirrors a public strategy's rules in your own paper run. No real funds, no live orders." }); },
  async syncCopy(id) {
    const i = copies.findIndex((c) => c.strategyId === id); if (i < 0) throw new ApiErr("not_found", "Copy not found.", 404); const c = copies[i];
    if (c.detached) throw new ApiErr("forbidden", "This copy ended when you unfollowed the trader. Copy again to start a new one.", 403, { reason: "detached" });
    if (!following.has(c.sourceHandle)) throw new ApiErr("forbidden", `Follow ${c.sourceHandle} again to sync.`, 403, { reason: "not_following" });
    copies[i] = { ...c, sourceVersion: c.latestSourceVersion ?? c.sourceVersion, behind: false, syncedAt: new Date().toISOString() }; return copies[i];
  },
};
