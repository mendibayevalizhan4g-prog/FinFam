// Part 1 of the panel: the Advisor. What is left this month, advice from our models,
// "Is it worth it?" and questions to the built-in advisor.
import { CATEGORY_NAMES, isSpending, monthSummary, planGoals, upcomingRecurring } from "../lib/finance.js";
import { addDays, monthIndex, monthName } from "../lib/dates.js";
import { checkPurchase } from "../lib/verdict.js";
import { answer, answerTopic, TOPICS } from "../lib/assistant.js";
import { $, $$, BAR, busy, closeSheet, dayLabel, esc, formData, money, pct, sheet, toast } from "../lib/ui.js";

const TONE = { buy: "green", think: "amber", not_worth_it: "red" };
const ICON = { buy: "✓", think: "?", not_worth_it: "✕" };
const ASK_CHIPS = ["can_spend", "budget_left", "spending", "upcoming", "where_losing", "goals", "postponed"];
const chat = []; // this panel session's questions with their answers: { q, a: { text, topic, alternatives, typed } }
const CHAT_KEEP = 20; // older questions are dropped, so the chat never grows without end

const marketVs = (r) => { const d = r.explain.market.diff; return Math.abs(d) < 0.05 ? "your price is about average" : `your price is ${pct(Math.abs(d))} ${d > 0 ? "above" : "below"}`; };

export function verdictCard(r) {
  const e = r.explain;
  return `<div class="verdict ${r.decision}" role="status">
    <div class="head"><span class="v-icon" aria-hidden="true">${ICON[r.decision]}</span>
      <div><div class="decision">${esc(r.title_text)}</div><div class="xs muted">${esc(r.title || "This item")} · ${money(r.price, 2)} · ${esc(r.category_name)}</div></div></div>
    <div class="body">
      <p class="v-family">${esc(e.family)}</p>
      ${e.why ? `<p class="small">${esc(e.why)}</p>` : ""}
      ${e.market?.average != null ? `<div class="v-market"><span class="xs muted">Average market price</span><b class="num">${money(e.market.average)}</b><span class="xs muted">${esc(marketVs(r))} · most similar items ${money(e.market.low)}–${money(e.market.high)}</span>
          <details><summary class="xs">${e.market.count} similar products in our database (2023 prices)</summary><ul class="xs">${r.market.similar.map((x) => `<li>${money(x.price, 2)} · ${esc(x.title.slice(0, 70))}</li>`).join("")}</ul></details></div>`
        : e.market ? `<p class="xs muted">${esc(e.market.text)}</p>` : ""}
      ${e.fair ? `<p class="small"><b>${esc(e.fair)}</b></p>` : ""}
    </div></div>`;
}

function leftRow(c) {
  const left = c.budget - c.spent, over = left < 0;
  const tone = c.light === "red" ? "red" : c.light === "yellow" ? "amber" : "green";
  return `<div class="row" style="display:block">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
      <b>${esc(c.name)}</b><span class="num ${over ? "neg" : ""}"><b>${money(Math.abs(left))}</b> ${over ? "over" : "left"}</span></div>
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
      <span class="xs muted num">${money(c.spent)} spent of usual ${money(c.budget)}</span>
      <span class="tag ${tone}" title="ML chance of going over by month end">${pct(c.overspend_probability)} risk</span></div>
    <div class="bar" aria-hidden="true"><span style="width:${Math.min(100, (c.spent / c.budget) * 100)}%;background:${BAR[c.light] || "var(--muted)"}"></span></div>
  </div>`;
}

function adviceCards(app, sum) {
  const s = app.store, tx = s.data.transactions, cards = [];
  const risky = sum.categories.filter((c) => c.budget && c.light === "red").sort((a, b) => b.overspend_probability - a.overspend_probability)[0];
  if (risky) {
    const left = risky.budget - risky.spent;
    const need = s.kindOf(risky.category) === "need";
    cards.push(["red", need ? `Plan ahead for ${risky.name}` : `Slow down on ${risky.name}`, left > 0
      ? `${pct(risky.overspend_probability)} chance to go over. ${money(left)} left for ${sum.days_left} days — about ${money(left / Math.max(1, sum.days_left))} a day.`
      : `Already ${money(-left)} over the usual ${money(risky.budget)}. Try to pause it until ${monthName(monthIndex(app.today) + 1)}.`]);
  }
  const week = upcomingRecurring(app.models, tx, app.today, 7).filter((u) => u.amount < 0);
  const plans = s.data.plans.filter((p) => p.date >= app.today && p.date <= addDays(app.today, 7));
  const due = [...week.map((u) => [u.date, u.name, -u.amount]), ...plans.map((p) => [p.date, p.name, p.amount])].sort();
  if (due.length) cards.push(["amber", `Due this week: ${money(due.reduce((a, d) => a + d[2], 0))}`,
    due.slice(0, 3).map(([d, n, a]) => `${dayLabel(d)} ${n} ${money(a)}`).join(" · ") + (due.length > 3 ? ` · +${due.length - 3} more` : "")]);
  const last = monthIndex(app.today) - 1;
  const monthly = (mi, c) => -tx.filter((t) => monthIndex(t.date) === mi && t.category === c && isSpending(t)).reduce((a, t) => a + t.amount, 0);
  const grew = [...new Set(tx.filter(isSpending).map((t) => t.category))].map((c) => {
    const h = [1, 2, 3, 4, 5, 6].map((k) => monthly(last - k, c)).sort((a, b) => a - b);
    return { c, now: monthly(last, c), usual: (h[2] + h[3]) / 2 };
  }).filter((g) => g.usual > 0 && g.now - g.usual > 30).sort((a, b) => b.now - b.usual - (a.now - a.usual))[0];
  if (grew) cards.push(["gray", `${CATEGORY_NAMES[grew.c] || grew.c} grew last month`, `${money(grew.now)} in ${monthName(last)} vs a usual ${money(grew.usual)}.`]);
  const goal = planGoals(s.data.goals, sum.free_cash_per_month, app.today).find((g) => !g.on_track);
  if (goal) cards.push(["amber", `“${goal.name}” is behind`, `Needs ${money(goal.needed_per_month)} a month; the family keeps about ${money(sum.free_cash_per_month)}.`]);
  if (!cards.length) cards.push(["green", "All good this month", "No category is likely to go over, and nothing big is due this week."]);
  return cards.map(([tone, title, text]) => `<div class="advice ${tone}"><b>${esc(title)}</b><div class="small">${esc(text)}</div></div>`).join("");
}

function goalsBlock(app, free) {
  const goals = planGoals(app.store.data.goals, free, app.today);
  return `${goals.map((g) => `<div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(g.name)}</b><span class="tag ${g.on_track ? "green" : "red"}">${g.on_track ? "On track" : "Behind"}</span></div>
      <div class="xs muted num">${money(g.saved)} of ${money(g.target)} by ${esc(g.deadline)} · needs ${money(g.needed_per_month)}/month</div>
      <div class="bar" aria-hidden="true"><span style="width:${Math.min(100, g.progress * 100)}%;background:var(--brand)"></span></div></div>`).join("")
    || `<p class="small muted" style="margin:0">No goals yet. Add one and the advisor will tell you if a purchase delays it.</p>`}
    <button class="btn ghost sm" id="add-goal" style="margin-top:8px">+ Add goal</button>`;
}

// The chat lives in a window of fixed height. Only the latest question is open; earlier ones fold into one line each.
function botHtml(m, withAlts) {
  const meta = m.typed && TOPICS[m.topic] ? `<div class="meta">Understood as: ${esc(TOPICS[m.topic])}${withAlts && m.alternatives.length ? " · not it? try:" : ""}</div>` : "";
  const alts = withAlts && m.typed && m.alternatives.length ? `<div class="chips alt">${m.alternatives.map((t) => `<button class="chip" data-topic="${t}">${esc(TOPICS[t])}</button>`).join("")}</div>` : "";
  return `<div class="msg bot">${esc(m.text)}${meta}${alts}</div>`;
}
function chatHtml() {
  if (!chat.length) return `<p class="chat-empty small muted">Tap a question above or type your own. Answers come from your family's numbers.</p>`;
  return chat.map((turn, i) => (i < chat.length - 1
    ? `<details class="turn"><summary><span class="turn-q">${esc(turn.q)}</span></summary>${botHtml(turn.a, false)}</details>`
    : `<div class="turn last"><div class="msg me">${esc(turn.q)}</div>${botHtml(turn.a, true)}</div>`)).join("");
}

export async function advisor(el, app) {
  const s = app.store, tx = s.data.transactions;
  if (!tx.length) {
    el.innerHTML = `<div class="section empty" role="status"><h2>Nothing to advise on yet</h2>
      <p class="small muted">Add a few expenses and income in <b>Money</b>, or connect PayPal. Forecasts get reliable after about a month of data.</p>
      <button class="btn primary" id="to-money">Go to Money</button></div>`;
    return $("#to-money", el).addEventListener("click", () => app.go("money"));
  }
  const sum = monthSummary(app.models, tx, s.data.family.children, app.today);
  const rows = sum.categories.filter((c) => c.budget).sort((a, b) => (b.overspend_probability ?? 0) - (a.overspend_probability ?? 0));
  const monthName = new Date(`${app.today}T00:00:00`).toLocaleDateString("en-US", { month: "long" });
  el.innerHTML = `<div class="stack">
    <section class="hero" aria-label="This month">
      <div class="xs muted">${monthName} · ${sum.days_left} days left</div>
      <div class="hero-nums"><div><span class="xs muted">Spent</span><b class="num">${money(sum.spent_this_month)}</b></div>
        <div><span class="xs muted">Income</span><b class="num">${money(sum.income_this_month)}</b></div>
        <div><span class="xs muted">Kept / month</span><b class="num">${money(sum.free_cash_per_month)}</b></div></div>
    </section>
    <section class="section ask" aria-labelledby="h-ask">
      <div class="section-head"><h2 id="h-ask">Ask the advisor</h2><button class="btn ghost sm" id="chat-clear" hidden>Clear</button></div>
      <div class="chips scroll" id="ask-chips" role="group" aria-label="Quick questions">${ASK_CHIPS.map((t) => `<button class="chip" data-topic="${t}">${esc(TOPICS[t])}</button>`).join("")}</div>
      <div class="chat" id="chat" aria-live="polite" tabindex="0" aria-label="Advisor answers"></div>
      <form id="ask" class="ask-row"><input class="input" name="q" placeholder="e.g. how much did we spend on food?" aria-label="Your question" autocomplete="off"><button class="btn primary">Ask</button></form>
    </section>
    <section class="section" aria-labelledby="h-advice"><h2 id="h-advice" class="section-title">Advice</h2><div class="stack">${adviceCards(app, sum)}</div></section>
    <section class="section" aria-labelledby="h-check"><h2 id="h-check" class="section-title">Is it worth it?</h2>
      <form id="check" class="stack" novalidate>
        <div class="grid-check"><label class="field">What<input class="input" name="title" required placeholder="Nike running shoes"></label>
          <label class="field">Price, $<input class="input" name="price" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="120"></label></div>
        <button class="btn primary block">Check</button></form>
      <div id="verdict" style="margin-top:12px"></div></section>
    <section class="section" aria-labelledby="h-left"><div class="section-head"><h2 id="h-left">Left to spend this month</h2><span class="xs muted">vs your usual month</span></div>
      <div id="left">${rows.slice(0, 4).map(leftRow).join("") || `<p class="small muted">Not enough history yet.</p>`}</div>
      ${rows.length > 4 ? `<button class="btn ghost sm" id="all-left">Show all ${rows.length}</button>` : ""}</section>
    <section class="section" aria-labelledby="h-goals"><h2 id="h-goals" class="section-title">Goals</h2><div id="goals">${goalsBlock(app, sum.free_cash_per_month)}</div></section>
  </div>`;

  $("#all-left", el)?.addEventListener("click", (e) => { $("#left", el).innerHTML = rows.map(leftRow).join(""); e.currentTarget.remove(); });
  $("#check", el).addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.title.trim() || !(Number(f.price) > 0)) return toast("Write what it is and its price.");
    busy(e.submitter, async () => {
      await app.marketReady;
      const r = checkPurchase(app, { title: f.title.trim(), price: Number(f.price) });
      $("#verdict", el).innerHTML = verdictCard(r) + (r.decision !== "buy"
        ? `<button class="btn ghost sm" id="postpone" style="margin-top:8px">Postpone · remind me next month</button>` : "");
      $("#postpone", el)?.addEventListener("click", async (ev) => {
        const on = await s.postpone({ title: r.title, price: r.price, category: r.category, decision: r.decision, url: "" });
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = `Postponed ✓ reminder ${on}`;
      });
    });
  });

  const showChat = (fresh = false) => {
    const box = $("#chat", el);
    box.innerHTML = chatHtml();
    box.classList.toggle("fresh", fresh); // animate only a new answer, not every redraw
    $("#chat-clear", el).hidden = !chat.length;
    $$("[data-topic]", box).forEach((b) => b.addEventListener("click", () => ask(b.textContent, b.dataset.topic)));
    // The newest question sits at the top of the window, with the previous one peeking above it
    // (so it is clear that earlier answers are one scroll away). The page itself does not move.
    const top = $(".turn.last", box)?.previousElementSibling;
    box.scrollTop = top ? top.offsetTop - 8 : 0;
  };
  // A mouse wheel moves the line of quick questions sideways.
  $("#ask-chips", el).addEventListener("wheel", (e) => {
    const row = e.currentTarget;
    if (!e.deltaY || row.scrollWidth <= row.clientWidth) return;
    e.preventDefault();
    row.scrollLeft += e.deltaY;
  }, { passive: false });
  const ask = async (text, topic = null) => {
    await app.marketReady;
    let a;
    try {
      const r = topic ? { ...answerTopic(app, topic, text), alternatives: [] } : answer(app, text);
      a = { text: r.reply, topic: r.topic, alternatives: r.alternatives || [], typed: !topic };
    } catch (err) { a = { text: err.message, alternatives: [] }; }
    chat.push({ q: text, a });
    chat.splice(0, Math.max(0, chat.length - CHAT_KEEP));
    showChat(true);
  };
  $$("#ask-chips > [data-topic]", el).forEach((b) => b.addEventListener("click", () => ask(b.textContent, b.dataset.topic)));
  $("#chat-clear", el).addEventListener("click", () => { chat.length = 0; showChat(); });
  $("#ask", el).addEventListener("submit", (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (!q) return;
    e.target.q.value = "";
    ask(q);
  });
  showChat();

  $("#add-goal", el).addEventListener("click", () => {
    const box = sheet(`<div class="section-head"><h2>New goal</h2><button class="btn ghost sm" id="cancel">Cancel</button></div>
      <form id="goal" class="stack" novalidate>
        <label class="field">Goal<input class="input" name="name" required placeholder="Summer trip"></label>
        <div class="grid2"><label class="field">Target, $<input class="input" name="target" type="number" min="1" required></label>
          <label class="field">Saved so far, $<input class="input" name="saved" type="number" min="0" value="0"></label></div>
        <label class="field">By<input class="input" name="deadline" type="date" min="${addDays(app.today, 1)}" required></label>
        <button class="btn primary block">Add goal</button></form>`, "New goal");
    $("#cancel", box).addEventListener("click", closeSheet);
    $("#goal", box).addEventListener("submit", (e) => {
      e.preventDefault();
      busy(e.submitter, async () => { await s.addGoal(formData(e.target)); closeSheet(); app.refresh(); });
    });
  });
}
