// Product verdict: Buy / Think about it / Not worth it (port of ml/verdict.py).
// Inputs are ML outputs: overspend risk, market price from our database, the family's usual prices, goals.
import { FORECAST_CATEGORIES } from "./features.js";
import { CATEGORY_NAMES, isSpending, monthlyFreeCash, planGoals, riskRow, familyState, usualP90, yearlyIncome, AVG_DAYS_IN_MONTH } from "./finance.js";
import { daysInMonth, dayOf, monthIndex, firstOfMonth, parse } from "./dates.js";

const RED_RISK = 0.75, MIN_RISK_JUMP = 0.05, MIN_THINK_JUMP = 0.02, MARKET_TOLERANCE = 0.10, MIN_GOAL_PRICE = 20;
// Show a market price only if the listed price is within 3x of the similar items' range (ml/train_price_knn.py:
// on unseen stores this keeps 96% of items at 32.7% median error; the hidden 4% had 88.6%, mostly accessories with the same name).
const MARKET_GATE = 3;
const niceDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
const pct = (p) => `${Math.round(p * 100)}%`;

// ------------------------------------------------------------------ product category

const SITE_CATEGORIES = {
  "amazon.": "shopping", "walmart.": "shopping", "target.": "shopping", "ebay.": "shopping", "etsy.": "shopping",
  "bestbuy.": "shopping", "temu.": "shopping", "shein.": "shopping", "aliexpress.": "shopping", "nike.": "shopping",
  "doordash.": "dining", "ubereats.": "dining", "grubhub.": "dining", "instacart.": "groceries", "wholefoodsmarket.": "groceries",
  "ticketmaster.": "entertainment", "stubhub.": "entertainment", "steampowered.": "entertainment", "fandango.": "entertainment",
  "livenation.": "entertainment", "booking.": "travel", "expedia.": "travel", "airbnb.": "travel", "delta.": "travel",
  "united.": "travel", "sephora.": "personal_care", "ulta.": "personal_care", "cvs.": "health", "walgreens.": "health",
};
const TITLE_KEYWORDS = {
  education_childcare: ["textbook", "school supplies", "backpack for school", "calculator", "notebook", "pencil", "tuition", "course"],
  health: ["vitamin", "supplement", "medicine", "first aid", "thermometer", "allergy", "pain relief"],
  groceries: ["grocery", "groceries", "snack", "coffee beans", "cereal", "pantry", "beverage", "organic food"],
  entertainment: ["ticket", "concert", "festival", "game pass", "video game", "playstation", "xbox", "nintendo", "movie"],
  travel: ["flight", "hotel", "airfare", "vacation package"],
  personal_care: ["shampoo", "skincare", "makeup", "cosmetic", "perfume", "razor"],
  subscriptions: ["subscription", "membership", "monthly plan"],
  dining: ["restaurant", "meal delivery", "pizza", "burger"],
};
const MARKET_CATEGORIES = new Set(["shopping", "personal_care", "health", "education_childcare", "groceries"]);

export function categoryForProduct(title, url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* no url */ }
  const low = (title || "").toLowerCase();
  const byWords = (cats) => Object.entries(TITLE_KEYWORDS).find(([c, ws]) => cats.includes(c) && ws.some((w) => low.includes(w)))?.[0];
  const site = Object.entries(SITE_CATEGORIES).find(([k]) => host.includes(k))?.[1];
  if (site) return byWords(["education_childcare", "health", "entertainment"]) || site;
  return byWords(Object.keys(TITLE_KEYWORDS)) || "shopping";
}

// ------------------------------------------------------------------ decision rules

export function decide(s) {
  const reasons = [], checks = {};
  const overMarket = s.marketHigh != null && s.price > s.marketHigh * (1 + MARKET_TOLERANCE);
  const nearTop = s.marketLow != null && !overMarket && s.price > (s.marketLow + s.marketHigh) / 2;
  checks.above_market = overMarket;
  if (overMarket) reasons.push(`Similar items cost ${money(s.marketLow)}–${money(s.marketHigh)}; this is ${pct(s.price / s.marketHigh - 1)} above that range.`);
  if (s.isNeed) {
    checks.need = true;
    if (!overMarket) reasons.push(`${s.categoryName} counts as a need, and the price looks normal.`);
    return { decision: overMarket ? "not_worth_it" : nearTop ? "think" : "buy", reasons, checks };
  }
  const jump = s.riskAfter != null && s.riskBefore != null ? s.riskAfter - s.riskBefore : 0;
  const highRisk = s.riskAfter != null && s.riskAfter >= RED_RISK && jump >= MIN_RISK_JUMP;
  // Judge the purchase, not the month (same as ml/verdict.py v4.3).
  const crosses = s.riskBefore != null && s.riskAfter != null && s.riskBefore < s.warnThreshold && s.warnThreshold <= s.riskAfter;
  const someRisk = s.riskAfter != null && s.riskAfter >= s.warnThreshold && (jump >= MIN_THINK_JUMP || crosses);
  const already = s.riskAfter != null && s.riskAfter >= s.warnThreshold && !someRisk && !highRisk;
  checks.high_risk = highRisk;
  if (s.riskAfter != null && (highRisk || someRisk)) {
    reasons.push(`Chance of going over your usual ${s.categoryName} spending this month: ${pct(s.riskBefore)} → ${pct(s.riskAfter)} with this purchase.`);
  } else if (already) {
    reasons.push(`${s.categoryName} is already likely to go over this month (${pct(s.riskAfter)}), but this purchase barely changes it (+${Math.round(Math.max(0, jump) * 100)} points).`);
  }
  const aboveUsual = s.usualP90 != null && s.price > s.usualP90;
  checks.above_usual = aboveUsual;
  if (aboveUsual) reasons.push(`More than your family usually pays for ${s.categoryName}: 9 out of 10 of your purchases there are under ${money(s.usualP90)}.`);
  const hurtsGoal = s.goalBehind && s.price >= MIN_GOAL_PRICE;
  checks.hurts_behind_goal = hurtsGoal;
  if (hurtsGoal) reasons.push(`Your goal “${s.goalName}” is already behind; this pushes it back${s.goalDelayDays ? ` by about ${s.goalDelayDays} days` : ""}.`);
  if (overMarket || highRisk || aboveUsual || hurtsGoal) return { decision: "not_worth_it", reasons, checks };
  if (someRisk || nearTop) {
    if (nearTop && !someRisk) reasons.push(`The price is in the upper half of what similar items cost (${money(s.marketLow)}–${money(s.marketHigh)}).`);
    return { decision: "think", reasons, checks };
  }
  if (!reasons.length) reasons.push("Fits your budget and your usual prices.");
  return { decision: "buy", reasons, checks };
}

export function reasonablePrice(riskAt, threshold, upper, tol = 1) {
  if (riskAt(1) >= threshold) return null;
  let lo = 1, hi = Math.max(upper, 2);
  if (riskAt(hi) < threshold) return hi;
  while (hi - lo > tol) { const mid = (lo + hi) / 2; if (riskAt(mid) < threshold) lo = mid; else hi = mid; }
  return lo;
}

// ------------------------------------------------------------------ full check

export function checkPurchase(app, { title = "", price, url = "", category = null }) {
  const s = app.store, models = app.models, today = app.today, tx = s.data.transactions;
  if (!tx.length) throw new Error("No money data yet. Add your expenses and income first.");
  price = Number(price);
  if (!(price > 0)) throw new Error("Enter a price above $0.");
  const cat = CATEGORY_NAMES[category] ? category : categoryForProduct(title, url);
  const kind = s.kindOf(cat), isNeed = kind === "need", name = CATEGORY_NAMES[cat] || cat;
  let market = title.trim() && MARKET_CATEGORIES.has(cat) && app.market ? app.market.lookup(title) : null, marketUnclear = null;
  if (market && (price < market.low / MARKET_GATE || price > market.high * MARKET_GATE)) { marketUnclear = market; market = null; }

  const state = familyState(tx, s.data.family.children, today);
  const forecastable = FORECAST_CATEGORIES.includes(cat);
  const before = forecastable ? riskRow(models, state, cat, today, 0) : null;
  const after = forecastable ? riskRow(models, state, cat, today, price) : null;
  const threshold = models.overspendSpec.threshold;

  const free = monthlyFreeCash(tx, today);
  const goal = planGoals(s.data.goals, free, today).find((g) => !g.on_track) || null;
  const delay = goal && free > 0 ? Math.round(price / (free / AVG_DAYS_IN_MONTH)) : null;

  const v = decide({ price, categoryName: name, isNeed, riskBefore: before?.p ?? null, riskAfter: after?.p ?? null,
    warnThreshold: threshold, usualP90: usualP90(tx, cat, today), marketLow: market?.low ?? null, marketHigh: market?.high ?? null,
    goalName: goal?.name, goalBehind: !!goal && !isNeed, goalDelayDays: delay });

  // Sanity rules on top of decide() (which stays a line-by-line port of ml/verdict.py, checked by 1,536 cases).
  // decide() can only object when it has something to compare with: a forecast, the family's usual prices, a market
  // price or a goal. A new family has none of these, so without these rules any price came out as "Worth it".
  const monthIncome = yearlyIncome(tx, today) / 12;
  const historyMonths = new Set(tx.map((t) => monthIndex(t.date))).size - 1; // full months before this one
  const usual = usualP90(tx, cat, today);
  const thisMonth = tx.filter((t) => monthIndex(t.date) === monthIndex(today) && t.source !== "allowance");
  const cashIn = thisMonth.filter((t) => t.category === "income").reduce((a, t) => a + t.amount, 0);
  const cashOut = -thisMonth.filter(isSpending).reduce((a, t) => a + t.amount, 0);
  const cashLeft = cashIn > 0 ? cashIn - cashOut : null; // what is left of this month's income; null if no income is written yet
  const FITS = "Fits your budget and your usual prices."; // decide()'s default line: true only if there was something to check
  if (monthIncome > 0 && price > monthIncome) {
    // 1. More than the family earns in a month is never "Worth it" on its own, need or want.
    v.decision = "not_worth_it";
    v.checks.beyond_income = true;
    v.reasons = [`This costs more than your family earns in a month (about ${money(monthIncome)}).`, ...v.reasons.filter((x) => x !== FITS && !x.includes("counts as a need"))];
  } else if (v.decision === "buy" && !isNeed && !before) {
    // No forecast for this category yet, so the month's own money is the only budget check there is.
    if (cashLeft != null && price > cashLeft) {
      // 2. More than what is left of this month's income.
      v.decision = "think";
      v.checks.beyond_month_cash = true;
      v.reasons = [cashLeft > 0 ? `This is more than the ${money(cashLeft)} left from this month's income, so it would come out of savings.`
        : "This month's income is already spent, so this would come out of savings."];
    } else if (usual == null && !market) {
      // 3. Nothing to compare the price with: say so instead of claiming that it fits.
      v.decision = "think";
      v.checks.no_history = true;
      v.reasons = [`FinPilot cannot judge this price yet: it needs at least 5 of your ${name} purchases or a close match in the price database.`];
    }
  }
  // "Worth it" always says what was actually checked.
  if (v.decision === "buy" && v.reasons[0] === FITS) {
    const parts = [];
    if (after) parts.push(`the chance of overspending on ${name} stays at ${pct(after.p)}`);
    if (usual != null) parts.push(`the price is within what your family usually pays for ${name} (9 of 10 purchases are under ${money(usual)})`);
    if (market) parts.push("the price is not above similar items");
    if (!parts.length && cashLeft != null) parts.push("it fits what is left of this month's income");
    if (parts.length) { const t = parts.join(", and "); v.reasons[0] = `Checked: ${t}.`; }
  }

  let reasonable = null;
  if (before && !isNeed) reasonable = reasonablePrice((x) => riskRow(models, state, cat, today, x).p, threshold, Math.max(price * 3, 50));
  const { y, m } = parse(today);
  const r = {
    ...v, title_text: TITLES[v.decision],
    category: cat, category_name: name, kind, risk_before: before?.p ?? null, risk_after: after?.p ?? null,
    spent_this_month: before?.row.spent_to_date ?? null, budget: before?.row.budget ?? null,
    left_this_month: before ? before.row.budget - before.row.spent_to_date : null, days_left: daysInMonth(y, m) - dayOf(today),
    usual_rest_of_month: before ? before.row.hist_after_day_ratio * before.row.budget : null,
    market, market_unclear: marketUnclear && { low: marketUnclear.low, high: marketUnclear.high }, reasonable_price: reasonable, no_room_this_month: !!before && !isNeed && reasonable === null,
    next_month_starts: firstOfMonth(monthIndex(today) + 1), goal: goal?.name || null, goal_delay_days: delay, free_cash: free, month_income: monthIncome, history_months: historyMonths, cash_in: cashIn, cash_out: cashOut, cash_left: cashLeft, title, price, url,
  };
  return { ...r, explain: explainVerdict(r) };
}

// ------------------------------------------------------------------ short explanation (same text in the panel and on the page)

export const TITLES = { buy: "Worth it", think: "Think about it", not_worth_it: "Not worth it" };

export function explainVerdict(r) {
  let family;
  if (r.budget != null) {
    const left = r.left_this_month, days = `${r.days_left} day${r.days_left === 1 ? "" : "s"} to go`;
    const usual = r.usual_rest_of_month >= 5 ? ` You usually spend about ${money(r.usual_rest_of_month)} more by month end.` : "";
    family = left > 0
      ? `${r.category_name}: ${money(left)} left of your usual ${money(r.budget)} this month (${days}).` +
        (r.price > left ? ` This ${money(r.price)} would put you ${money(r.price - left)} over.` : usual)
      : `${r.category_name}: already ${money(-left)} over your usual ${money(r.budget)} this month (${days}).`;
  } else {
    // No forecast for this category: show this month's real money instead of a guess about the family.
    family = r.cash_left != null
      ? `This month: ${money(r.cash_in)} came in, ${money(r.cash_out)} is spent, ${r.cash_left >= 0 ? `${money(r.cash_left)} is left` : `${money(-r.cash_left)} over`}.` +
        (r.cash_left >= r.price ? ` After this ${money(r.price)}: ${money(r.cash_left - r.price)}.` : "")
      : r.free_cash > 0 ? `Your family keeps about ${money(r.free_cash)} a month after all spending.`
      : r.history_months === 0 ? "No income is written in Money yet, so FinPilot cannot check this against your budget."
      : "Over the last months your family spent about as much as it earned.";
  }
  let why = r.reasons.find((x) => !x.startsWith("Similar items cost") && !x.startsWith("The price is in the upper half")) || null;
  if (why && /^Chance of going over/.test(why) && r.risk_after != null) {
    why = `ML forecast: ${pct(r.risk_before)} → ${pct(r.risk_after)} chance to overspend on ${r.category_name} this month with this purchase.`;
  } else if (why && / is already likely to go over/.test(why) && r.risk_after != null) {
    const pts = Math.round(Math.max(0, r.risk_after - r.risk_before) * 100);
    why = `ML forecast: ${r.category_name} is already ${pct(r.risk_after)} likely to go over this month, but this purchase adds only ${pts} point${pts === 1 ? "" : "s"}.`;
  }
  let market = null;
  if (r.market) {
    const diff = r.price / r.market.median - 1;
    const vs = Math.abs(diff) < 0.05 ? "about the average" : `${pct(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the average`;
    market = { average: r.market.median, low: r.market.low, high: r.market.high, count: r.market.count, diff,
      text: `Average market price: ${money(r.market.median)} (most similar items ${money(r.market.low)}–${money(r.market.high)}). This price is ${vs}.` };
  } else if (r.market_unclear) {
    market = { average: null, text: `No close match in our price database: items with similar names cost ${money(r.market_unclear.low)}–${money(r.market_unclear.high)} (often accessories or other versions).` };
  }
  const fair = r.decision === "buy" ? null : r.checks?.beyond_income && !r.reasonable_price ? null : r.reasonable_price ? `A price that fits your budget now: up to ${money(r.reasonable_price)}.`
    : r.no_room_this_month ? `No price fits your ${r.category_name} budget this month; a fresh month starts ${niceDate(r.next_month_starts)}.` : null;
  return { family, why, market, fair };
}
