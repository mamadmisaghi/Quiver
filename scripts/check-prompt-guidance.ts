import assert from "node:assert/strict";
import { test } from "node:test";
import { addDraftDetail, classifyDraftPrompt, type PromptLocale, type PromptOptions } from "@/services/backend/src/compile/prompt-guidance";

type Case = {
  input: string;
  options?: PromptOptions;
  expect: "guide" | "market" | "detail" | "pass";
  locale?: PromptLocale;
  market?: string;
};

// Exported so the same corpus can run against another implementation.
export const corpus: Case[] = [
  ...["CSDF", "csdf", "CSDFSDFSDFSDF", "csdfsdfsdfsdf", "ASDFGHJKL", "asdfghjkl qwertyuiop", "!!!!!!!!", "🤷‍♂️",
    "Hello, Quiver!", "what can you do?", "Just testing.", "Tell me a joke."].map(
    input => ({ input, expect: "guide" as const, locale: "en" as const })),
  ...["سلام!", "سلام، خوبی؟", "این یک تست است.", "سسسسسسسس"].map(
    input => ({ input, expect: "guide" as const, locale: "fa" as const })),
  ...[
    ["NEET", "NEET"], ["btc", "BTC"], ["Bitcoin?", "BTC"], ["ＮＶＤＡ", "NVDA"],
    ["PUMP.FUN", "PUMP"], ["$farcoin", "FARCOIN"], ["PEPE", "PEPE"], ["TQQQ", "TQQQ"],
    ["ZYXQ", "ZYXQ"], ["1INCH", "1INCH"], ["BRK.B", "BRK.B"],
    ["NEET / BTC", "NEET/BTC"], ["btc/usdt", "BTC/USDT"], ["$TEST", "TEST"],
  ].map(([input, market]) => ({ input, market, expect: "market" as const, locale: "en" as const })),
  ...[["بیت‌کوین؟", "BTC"], ["بيت كوين", "BTC"], ["نیت", "NEET"], ["پامپ فان", "PUMP"], ["$گربه", "گربه"]].map(
    ([input, market]) => ({ input, market, expect: "market" as const, locale: "fa" as const })),
  { input: "BUY $50 OF XYZ", expect: "detail", market: "XYZ", locale: "en" },
  { input: "Hello, buy BTC when RSI falls below 30.", expect: "detail", market: "BTC", locale: "en" },
  { input: "Buy BTC", expect: "detail", market: "BTC", locale: "en" },
  { input: "If BTC drops 5%, buy BTC.", expect: "detail", market: "BTC", locale: "en" },
  { input: "Buy $100 of NEET", expect: "detail", market: "NEET", locale: "en" },
  { input: "BTC", options: { locale: "fa" }, expect: "market", market: "BTC", locale: "fa" },
  { input: "CSDFSDFSDFSDF", options: { locale: "fa" }, expect: "guide", locale: "fa" },
  ...[
    "", "   ", "BUY", "RSI", "BTC below 50k", "buy the dip",
     "Buy $100 of NEET every time NEET drops 10%",
    "Buy CSDFSDFSDFSDF when it drops 10%", 
    "BTC و NEET", "اگر بیت‌کوین افت کرد بخر", "حد ضرر را ۵٪ کن", "بخر",
    "Comprar BTC si cae un 5 %", "COMPRA", "ACHETER", "KAUFEN", "若比特币下跌5%，买入", "اشترِ بيتكوين إذا انخفض ٥٪",
    "BUY/SELL", "100", "$100", "落ちたら買う", "constructor", "__proto__",
    "Set stop loss to 2%", "exit at the dashed line",
  ].map(input => ({ input, expect: "pass" as const })),
  { input: "BTC", options: { context: "chart" }, expect: "pass" },
  { input: "CSDFSDFSDFSDF", options: { context: "chart" }, expect: "pass" },
  { input: "NEET", options: { context: "edit" }, expect: "pass" },
  { input: "BTC", options: { context: "continuation" }, expect: "pass" },
  { input: "سلام", options: { context: "continuation" }, expect: "pass" },
];

for (const row of corpus) {
  test(`${row.options?.context ?? "fresh"}/${row.options?.locale ?? "auto"} ${JSON.stringify(row.input)} → ${row.expect}`, () => {
    const result = classifyDraftPrompt(row.input, row.options);
    if (row.expect === "pass") return assert.equal(result, null);
    assert.ok(result);
    assert.equal(result.kind, row.expect);
    assert.equal(result.locale, row.locale);
    assert.equal(/\p{Script=Arabic}/u.test(result.message), row.locale === "fa");
    assert.doesNotMatch(result.message, /schema|array|stage(?:s|Id)?|Zod|QuiverWorkflow|expected|JSON|>=[0-9]/i);
    if (result.kind === "market") {
      assert.equal(result.market, row.market);
      assert.ok(result.message.includes(result.market));
    }
  });
}


test("complete a bare ticker and ask only for the missing field", () => {
  const market = classifyDraftPrompt("NEET");
  assert.ok(market?.kind === "market");
  const idea = addDraftDetail("NEET", market, "Buy when it falls 5%");
  assert.equal(idea, "Buy NEET when it falls 5%");
  const size = classifyDraftPrompt(idea);
  assert.ok(size?.kind === "detail" && size.field === "size");
  const complete = addDraftDetail(idea, size, "100");
  assert.equal(complete, "Buy $100 of NEET when it falls 5%");
  assert.equal(classifyDraftPrompt(complete), null);
});
