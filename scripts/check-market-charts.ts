import assert from "node:assert/strict";
import test from "node:test";
import { chartPrice, exactPrice } from "../lib/chart-format";
import { validBars, readMarketHistory } from "../lib/preview/market-history";
import { MarketHistoryRes } from "../lib/contracts/market";
test("fractional prices preserve significant digits and offer the original decimal", () => {
  assert.equal(chartPrice(0.000001234), "$0.0₅1234");
  assert.equal(chartPrice(0.01234), "$0.01234");
  assert.equal(chartPrice(0.5464, "percent"), "54.64%");
  assert.equal(
    exactPrice("0.0000001234567890123456"),
    "$0.0000001234567890123456",
  );
});
test("historical bars exclude incomplete, reversed, duplicate and out-of-window observations", () => {
  const b = { t: 50, o: 10, h: 13, l: 9, c: 11 };
  assert.deepEqual(
    validBars(
      [
        { ...b, t: 90 },
        b,
        { ...b, c: 12 },
        { ...b, t: 10 },
        { ...b, t: 110 },
        { ...b, t: 70, h: 8 },
        { ...b, t: 60, c: NaN },
      ],
      10,
      100,
    ),
    [
      { ...b, c: 12 },
      { ...b, t: 90 },
    ],
  );
});
test("perpetual history verifies the instrument and interval and uses the completed candle timestamp", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const { req } = JSON.parse(String(init?.body)),
        t = req.endTime + 1 - 900000;
      const ok = { t, s: "BTC", i: "15m", o: "10", h: "12", l: "9", c: "11" };
      return Response.json([
        ok,
        { ...ok, s: "ETH" },
        { ...ok, i: "1d" },
        { ...ok, t: t + 900000 },
      ]);
    };
    const h = MarketHistoryRes.parse(
      await readMarketHistory("hl:perp:BTC", "15m", "1d"),
    );
    assert.equal(h.bars.length, 1);
    assert.equal(h.bars[0].t, h.to);
    assert.equal(h.coverage[0].source, "Hyperliquid perpetual trades");
    assert.equal(h.synthetic, false);
    assert.equal(await readMarketHistory("unlisted:BTC", "15m", "1d"), null);
  } finally {
    globalThis.fetch = original;
  }
});
