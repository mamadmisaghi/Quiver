export type PromptLocale = "en" | "fa";
export type PromptOptions = {
  context?: "fresh" | "edit" | "chart" | "continuation";
  locale?: PromptLocale;
};
export type DraftGuidance =
  | { kind: "guide"; locale: PromptLocale; message: string }
  | { kind: "market"; locale: PromptLocale; market: string; message: string }
  | { kind: "detail"; locale: PromptLocale; market: string; field: "size" | "timing"; message: string };

const lookupKey = (s: string) => s.normalize("NFKC").toLowerCase()
  .replace(/[يى]/gu, "ی").replace(/ك/gu, "ک")
  .replace(/[\s\u200c\u200d]+/gu, " ").trim();

// Match entire asset aliases. A canonicalizer that uppercases arbitrary words
// cannot by itself decide whether the user has named a market.
const aliasesBySymbol: Record<string, string[]> = {
  BTC: ["bitcoin", "xbt", "بیتکوین", "بیت کوین"],
  ETH: ["ethereum", "ether", "اتریوم"], SOL: ["solana", "سولانا"],
  NEET: ["نیت", "نییت"], PUMP: ["pump.fun", "pumpfun", "pump fun", "پامپ فان"],
  NVDA: ["nvidia", "نویدیا", "انویدیا", "انودیا"],
  AAPL: ["apple"], MSFT: ["microsoft"], TSLA: ["tesla"], JUP: ["jupiter"],
  SPY: [], WETH: [], USD: [], USDT: [], USDC: [],
};
const aliases = new Map<string, string>();
for (const [symbol, names] of Object.entries(aliasesBySymbol)) {
  for (const name of [symbol, ...names]) aliases.set(lookupKey(name), symbol);
}

const conversationOnly = new Set([
  "hello", "hi", "hey", "hello quiver", "hello world", "help", "help me",
  "thank you", "thanks", "test", "testing", "just testing", "tell me a joke",
  "what is the weather", "what can you do",
  "سلام", "سلام کویور", "درود", "ممنون", "مرسی", "سلام خوبی", "راهنما",
  "تست", "این یک تست است", "یه جوک بگو", "یک لطیفه بگو",
].map(lookupKey));
// A bare indicator, trade direction or order type is an incomplete idea.
// Pass it through to the planner. An explicit cashtag can disambiguate a ticker.
const tradeWords = new Set((
  "BUY SELL LONG SHORT OPEN CLOSE EXIT STOP ALERT WATCH HOLD HEDGE LIMIT TRADE INVEST ENTER ADD EDIT SET REMOVE RISK " +
  "BUYING SELLING MARKET DAILY WEEKLY PRICE CROSS ABOVE BELOW OPTION CALL PUT LEVERAGE RSI SMA EMA MACD DCA TP SL " +
  "COMPRA COMPRAR VENDE VENDER COMPRARE VENDI VENDERE ACHETE ACHETER VENDS VENDRE KAUFEN KAUFE VERKAUFE"
).split(" "));
const tickerShape = /^(?=.*[A-Z])[A-Z0-9]{1,8}(?:[.-][A-Z0-9]{1,6})?$/;

function obviousNoise(text: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  if (/^([\p{L}])\1{7,}$/u.test(text)) return true;
  if (/^(?:csdf(?:sdf)*|asdf(?:gh(?:jkl?)?)?|asdfasdf|asdasdasd|qwerty(?:uiop|qwerty)?|zxcvbnm)$/i.test(text)) return true;
  // An entire long consonant-only token made from one small repeated block.
  // Short consonant tickers like WBTC or TQQQ remain valid follow-ups.
  return /^[bcdfghjklmnpqrstvwxyz]{9,}$/i.test(text) &&
    /^.?(.{1,4})\1{2,}.?$/i.test(text);
}

function bareMarket(text: string): string | undefined {
  const marked = text.startsWith("$");
  const value = marked ? text.slice(1) : text;
  const known = aliases.get(lookupKey(value));
  if (known) return known;
  if (marked && /^(?=\p{L})[\p{Script=Arabic}\p{N}\u200c]{1,16}$/u.test(value)) return value;
  const candidate = marked ? value.toUpperCase() : value;
  if (!tickerShape.test(candidate)) return;
  if (!marked && (tradeWords.has(candidate) || obviousNoise(candidate))) return;
  return candidate;
}

// Keep these fast paths narrow. Compound or multilingual instructions continue to the planner.
const singleOrder = /(?:^|,\s*)\b(buy|sell|long|short)\s+(?:(\$[\d,.]+(?:\s*(?:USD|USDT|USDC))?)(?:\s+of)?\s+)?(\$?[A-Za-z][A-Za-z.\d-]{0,11})(.*)$/i;
const sizeToken = /(?:\b(?:all|half|quarter|entire|budget|balance|margin|shares?|units?|contracts?)\b|(?:\bwith|\bfor|\busing|\bworth)\s+(?:\$|[\d.])|^\s*\$\d)/i;

function missingOrderDetail(text: string, locale: PromptLocale): DraftGuidance | null {
  const match = text.match(singleOrder);
  if (!match || /\b(?:and|then|or)\b/i.test(text) || text.includes("/")) return null;
  const [, side, size, rawMarket, rest] = match;
  const market = bareMarket(rawMarket);
  if (!market || (!rest.trim() && !size && !aliases.has(lookupKey(rawMarket)) && rawMarket !== rawMarket.toUpperCase())) return null;
  if (!size && !sizeToken.test(rest) && !/\b(?:\d+(?:\.\d+)?\s*(?:% of|USD)|all in)\b/i.test(text)) {
    return { kind: "detail", locale, market, field: "size", message: locale === "fa"
      ? `مبلغ این سفارش ${market} چند دلار باشد؟` : `How many dollars would you like to use for this ${market} order?` };
  }
  if (size && !rest.trim() && match.index === 0) return { kind: "detail", locale, market, field: "timing", message: locale === "fa"
    ? `سفارش ${market} همین حالا انجام شود یا وقتی شرطی برقرار شد؟`
    : `When should Quiver ${side.toLowerCase()} ${market} — now or when a condition is met?` };
  return null;
}

export function addDraftDetail(original: string, guidance: Exclude<DraftGuidance, { kind: "guide" }>, value: string) {
  const answer = value.trim(), text = original.trim().replace(/[.!?؟]+$/u, "");
  if (guidance.kind === "detail") {
    if (guidance.field === "size" && /^\$?[\d,]+(?:\.\d+)?(?:\s*(?:USD|dollars?))?$/i.test(answer)) {
      const amount = answer.replace(/[^\d.]/g, "");
      return text.replace(singleOrder, (_order, side, _size, symbol, rest) =>
        `${_order.startsWith(",") ? ", " : ""}${side} $${amount} of ${symbol}${rest}`);
    }
    return `${text} ${answer}`;
  }
  if (answer.toLowerCase().includes(guidance.market.toLowerCase())) return answer;
  const action = /^(buy|sell|long|short)\b(?:\s+(\$[\d,.]+))?(?=\s+(?:if|when|at|now|on|every|with|once)\b|$)/i;
  if (action.test(answer)) return answer.replace(action, (_all, side, amount) => amount
    ? `${side} ${amount} of ${guidance.market}` : `${side} ${guidance.market}`);
  return `${text} — ${answer}`;
}

/** Returns null whenever normal drafting, chart reading or clarification should proceed. */
export function classifyDraftPrompt(input: string, options: PromptOptions = {}): DraftGuidance | null {
  if (options.context && options.context !== "fresh") return null;
  const text = input.normalize("NFKC").trim();
  if (!text) return null;
  const value = text.replace(/[.!?…؟。！]+$/gu, "").trim();
  const locale = options.locale ?? (/\p{Script=Arabic}/u.test(value) ? "fa" : "en");
  const phrase = lookupKey(value.replace(/[,،]/gu, " "));
  if (conversationOnly.has(phrase) || value.split(/\s+/u).every(obviousNoise)) {
    return { kind: "guide", locale, message: locale === "fa"
      ? "چه چیزی می‌خواهی معامله کنی؟ مثلاً «اگر بیت‌کوین در یک روز ۵٪ افت کرد، ۱۰۰ دلار بخر.»"
      : "What would you like to trade? Try “Buy $100 of BTC if it drops 5% in a day.”" };
  }
  const detail = missingOrderDetail(value, locale);
  if (detail) return detail;
  const parts = value.split(/\s*\/\s*/u);
  if (parts.length > 2) return null;
  const symbols = parts.map(bareMarket);
  if (symbols.some(symbol => !symbol)) return null;
  const market = symbols.join("/");
  return { kind: "market", locale, market, message: locale === "fa"
    ? `می‌خواهی با «${market}» چه کار کنی و در چه شرایطی؟`
    : `What would you like to do with ${market}, and what should trigger it?` };
}
