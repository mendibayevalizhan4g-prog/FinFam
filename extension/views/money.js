// Part 2 of the panel: Money. The family writes expenses and income here (ML picks the category),
// sets its monthly income once (FinPilot adds it every month), sorts and filters the history,
// fixes categories, and can connect its PayPal account (Log in with PayPal).
import { CATEGORY_NAMES, isSpending } from "../lib/finance.js";
import { daysInMonth, fmt as ymd, monthIndex, monthName, monthStr } from "../lib/dates.js";
import { connectPaypal, disconnectPaypal, paypalConnected, syncPaypal } from "../lib/paypal.js";
import { $, $$, busy, closeSheet, esc, formData, money as fmt, sheet, shortDate, toast } from "../lib/ui.js";

const PAGE = 40;
const LINK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>`;
const SOURCE = { model: "ML", user: "you", paypal: "PayPal" };
const FROM = { paypal: " · PayPal", salary: " · monthly income" };
const TYPES = { all: "All", in: "Money in", out: "Money out" };
// Sort buttons: pressing the active one flips its direction. [label, hint when descending, hint when ascending]
const SORTS = { date: ["Date", "newest first", "oldest first"], amount: ["Amount", "largest first", "smallest first"], type: ["Type", "income first", "expenses first"] };
const START = { q: "", shown: PAGE, type: "all", cat: "", sort: "date", dir: "desc", dup: false };
const catOptions = (sel) => Object.entries(CATEGORY_NAMES).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

// History: filter (search, money in/out, category, "possible duplicates"), then sort. Pure, tested in test.html.
export function historyView(tx, st) {
  const q = (st.q || "").trim().toLowerCase();
  const list = tx.filter((t) => (st.type === "in" ? t.amount > 0 : st.type === "out" ? t.amount < 0 : true)
    && (!st.cat || t.category === st.cat) && (!st.dup || t.dup_of)
    && (!q || t.description.toLowerCase().includes(q) || (CATEGORY_NAMES[t.category] || "").toLowerCase().includes(q)));
  const sign = st.dir === "asc" ? 1 : -1;
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const cmp = st.sort === "amount" ? (a, b) => sign * (Math.abs(a.amount) - Math.abs(b.amount)) || -byDate(a, b)
    : st.sort === "type" ? (a, b) => sign * ((a.amount > 0) - (b.amount > 0)) || -byDate(a, b)
    : (a, b) => sign * byDate(a, b);
  return list.map((t, i) => [t, i]).sort((a, b) => cmp(a[0], b[0]) || sign * (a[1] - b[1])).map(([t]) => t); // stable in both directions
}

function dupFlag(t, twin) {
  if (!twin) return "";
  const pay = [t, twin].find((x) => x.income_id);
  const other = `${fmt(twin.amount, 2)} on ${shortDate(twin.date)}`;
  const question = pay ? `Is this your pay “${esc(pay.description)}”?` : t.amount > 0 ? "Is this the same money?" : "Is this the same payment?";
  const detail = pay && pay === twin ? `Your monthly income already added ${other}.`
    : `“${esc(twin.description)}”, ${other}, is already in your history${twin.source === "paypal" ? " (from PayPal)" : ""}.`;
  return `<span class="dup"><button type="button" class="dup-btn" aria-expanded="false" aria-label="Possible duplicate: ${esc(t.description)}">!</button>
    <span class="dup-pop" role="group" aria-label="Possible duplicate"><b>${question}</b><span class="xs">${detail}</span>
      <span class="dup-actions"><button type="button" class="btn primary sm" data-dup="same">Yes, the same</button><button type="button" class="btn ghost sm" data-dup="different">No, different</button></span>
      <span class="xs muted">“Yes” keeps one entry, “No” keeps both.</span></span></span>`;
}

function txRow(t, twin) {
  return `<li class="tx ${t.dup_of && twin ? "flagged" : ""}" data-id="${esc(t.id)}">
    <div class="tx-top"><span class="title">${esc(t.description)}</span>${dupFlag(t, twin)}<b class="num ${t.amount > 0 ? "pos" : ""}">${fmt(t.amount, 2)}</b></div>
    <div class="tx-bottom"><span class="xs muted">${shortDate(t.date)}${FROM[t.source] || ""} · category by ${SOURCE[t.category_source] || "file"}</span>
      <span class="tx-actions"><select class="select mini" data-cat aria-label="Category for ${esc(t.description)}">${catOptions(t.category)}</select>
        <button class="icon-btn" data-del aria-label="Delete ${esc(t.description)}" title="Delete">✕</button></span></div></li>`;
}

function nextPay(inc, today) {
  const mi = Math.max(inc.added_through + 1, monthIndex(today)), y = Math.floor(mi / 12), m = (mi % 12) + 1;
  return ymd(y, m, Math.min(inc.day, daysInMonth(y, m)));
}

export async function money(el, app, state = START) {
  state = { ...START, ...state };
  const s = app.store, cur = monthIndex(app.today);
  const tx = s.data.transactions;
  const month = tx.filter((t) => monthIndex(t.date) === cur);
  const income = month.filter((t) => t.category === "income" && t.source !== "allowance").reduce((a, t) => a + t.amount, 0); // same rule as the Advisor
  const spent = -month.filter(isSpending).reduce((a, t) => a + t.amount, 0);
  const connected = paypalConnected(s);
  const incomes = s.incomes();
  const perMonth = incomes.reduce((a, i) => a + i.amount, 0);
  const usedCats = [...new Set(tx.map((t) => t.category))].filter((c) => CATEGORY_NAMES[c]).sort((a, b) => CATEGORY_NAMES[a].localeCompare(CATEGORY_NAMES[b]));

  el.innerHTML = `<div class="stack">
    <div class="kpis"><div class="kpi out"><div class="label">Spent this month</div><div class="value num">${fmt(spent)}</div></div>
      <div class="kpi in"><div class="label">Income this month</div><div class="value num">${fmt(income)}</div></div></div>
    <section class="section" aria-labelledby="h-add">
      <div class="section-head"><h2 id="h-add">Add money in or out</h2>
        <button class="btn ${connected ? "ghost" : "paypal"} sm" id="paypal" aria-haspopup="dialog">${LINK_ICON}${connected ? `PayPal · ${esc((s.data.settings.paypal_name || "connected").split(" ")[0])}` : "Connect PayPal"}</button></div>
      <form id="add" class="stack" novalidate>
        <div class="seg block" role="group" aria-label="Expense or income">
          <button type="button" data-kind="expense" aria-pressed="true">Expense</button><button type="button" data-kind="income" aria-pressed="false">Income</button></div>
        <div class="grid2"><label class="field">Amount, $<input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label>
          <label class="field">Date<input class="input" name="date" type="date" value="${app.today}" max="${app.today}" required></label></div>
        <label class="field">What was it?<input class="input" name="description" required placeholder="Trader Joe's groceries" autocomplete="off"></label>
        <label class="field">Category<select class="select" name="category"><option value="">Auto (ML)</option>${catOptions("")}</select>
          <span class="xs muted" id="guess" aria-live="polite">Start typing — the ML model picks the category.</span></label>
        <button class="btn primary block" id="add-btn">Add expense</button>
      </form>
    </section>
    <section class="section" aria-labelledby="h-inc">
      <div class="section-head"><h2 id="h-inc">Monthly income</h2>
        ${incomes.length ? `<button class="btn ghost sm" id="inc-more" aria-expanded="false" aria-controls="inc-form" title="Add another job">+ Add job</button>` : ""}</div>
      <p class="xs muted" style="margin:0 0 8px">${incomes.length ? `${fmt(perMonth)} a month. FinPilot adds it to the history on pay day, and catches up on months you missed.`
        : "Write your pay once. FinPilot adds it every month on pay day, and catches up on months you missed."}</p>
      ${incomes.map((i) => `<div class="row inc" data-inc="${esc(i.id)}"><div class="main"><div class="title">${esc(i.name)}</div>
          <div class="xs muted">every ${ordinal(i.day)} · next ${shortDate(nextPay(i, app.today))}</div></div>
        <b class="num pos">${fmt(i.amount, 2)}</b><button class="icon-btn" data-inc-del aria-label="Stop adding ${esc(i.name)}" title="Stop adding it">✕</button></div>`).join("")}
      <form id="inc-form" class="inc-form" novalidate ${incomes.length ? "hidden" : ""}>
        <label class="field">Job or income<input class="input" name="name" required placeholder="${incomes.length ? "Second job" : "Salary"}" autocomplete="off"></label>
        <div class="grid3"><label class="field">Amount, $<input class="input" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="3200"></label>
          <label class="field">Pay day<input class="input" name="day" type="number" min="1" max="31" step="1" inputmode="numeric" required value="1" title="Day of the month"></label>
          <label class="field">Since<select class="select" name="since" title="First month to add. Pick an earlier month to fill the history.">${Array.from({ length: 13 }, (_, k) =>
            `<option value="${monthStr(cur - k)}">${k ? `${monthName(cur - k).slice(0, 3)} ${Math.floor((cur - k) / 12)}` : "This month"}</option>`).join("")}</select></label></div>
        <button class="btn primary block">${incomes.length ? "Add job" : "Save monthly income"}</button>
      </form>
    </section>
    <section class="section" aria-labelledby="h-list">
      <div class="section-head"><h2 id="h-list">History</h2><span class="xs muted" id="count"></span></div>
      <input class="input" id="search" type="search" value="${esc(state.q)}" placeholder="Search description or category" aria-label="Search history">
      <div class="filters">
        <div class="seg block three" role="group" aria-label="Show">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-type="${k}">${v}</button>`).join("")}</div>
        <div class="sort-row">
          <div class="sorts" role="group" aria-label="Sort by">${Object.entries(SORTS).map(([k, [label]]) => `<button type="button" class="chip sort" data-sort="${k}">${label}<span class="arrow" aria-hidden="true"></span></button>`).join("")}</div>
          <select class="select mini" id="cat-filter" aria-label="Category">
            <option value="">All categories</option>${usedCats.map((c) => `<option value="${c}">${esc(CATEGORY_NAMES[c])}</option>`).join("")}</select></div>
        <button type="button" class="dup-note" id="dup-note" hidden></button>
      </div>
      <div id="list-wrap"></div>
    </section>
  </div>`;

  // add form: expense/income switch and live ML category
  const form = $("#add", el);
  let kind = "expense";
  $$("[data-kind]", form).forEach((b) => b.addEventListener("click", () => {
    kind = b.dataset.kind;
    $$("[data-kind]", form).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#add-btn", el).textContent = kind === "income" ? "Add income" : "Add expense";
    guess();
  }));
  const guess = () => {
    const d = form.description.value.trim();
    if (!d) { form.category.options[0].textContent = "Auto (ML)"; return; }
    const amount = (kind === "income" ? 1 : -1) * (Number(form.amount.value) || 1);
    const c = s.categorize([{ amount, description: d, channel: "manual" }])[0].category;
    form.category.options[0].textContent = `Auto (ML): ${CATEGORY_NAMES[c] || c}`;
    $("#guess", el).textContent = form.category.value ? "You picked the category yourself." : `ML thinks: ${CATEGORY_NAMES[c] || c}. Change it if it's wrong.`;
  };
  form.description.addEventListener("input", guess);
  form.amount.addEventListener("input", guess);
  form.category.addEventListener("change", guess);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(form);
    busy(e.submitter, async () => {
      await s.addEntry({ kind, amount: f.amount, description: f.description, date: f.date, category: f.category || null });
      const t = s.data.transactions.find((x) => x.description === f.description.trim() && x.date === f.date && x.id.startsWith("manual-"));
      toast(`Added ${kind === "income" ? "income" : "expense"} ${fmt(Number(f.amount), 2)} · ${CATEGORY_NAMES[t?.category] || ""}`);
      money(el, app, { ...state, q: "", shown: PAGE });
    });
  });

  // monthly income: written once, added by FinPilot every month
  const incForm = $("#inc-form", el);
  $("#inc-more", el)?.addEventListener("click", (e) => {
    incForm.hidden = !incForm.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!incForm.hidden));
    e.currentTarget.textContent = incForm.hidden ? "+ Add job" : "Cancel";
    if (!incForm.hidden) incForm.name.focus();
  });
  incForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(incForm);
    busy(e.submitter, async () => {
      const n = await s.addIncome(f, app.today);
      toast(n ? `Saved. ${n} payment${n === 1 ? "" : "s"} of ${fmt(Number(f.amount), 2)} added to the history.` : `Saved. The first ${fmt(Number(f.amount), 2)} will be added on pay day.`, 5000);
      money(el, app, state);
    });
  });
  $$("[data-inc]", el).forEach((row) => $("[data-inc-del]", row).addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("confirm")) { b.classList.add("confirm"); b.textContent = "Stop?"; return setTimeout(() => { b.classList.remove("confirm"); b.textContent = "✕"; }, 3000); }
    await s.deleteIncome(row.dataset.inc);
    toast("Stopped. Payments already in the history stay.");
    money(el, app, state);
  }));

  // history: search, filter and sort without redrawing the rest of the page
  const wrap = $("#list-wrap", el);
  const renderList = () => {
    const all = s.data.transactions;
    const twins = new Map(s.duplicates().map((d) => [d.entry.id, d.twin]));
    if (!twins.size) state.dup = false;
    const list = historyView(all, state);
    $("#count", el).textContent = list.length === all.length ? `${all.length} entries` : `${list.length} of ${all.length}`;
    $$("[data-type]", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === state.type)));
    $$("[data-sort]", el).forEach((b) => {
      const on = b.dataset.sort === state.sort, [label, down, up] = SORTS[b.dataset.sort];
      b.setAttribute("aria-pressed", String(on));
      b.title = on ? `${label}: ${state.dir === "desc" ? down : up}. Press to flip.` : `Sort by ${label.toLowerCase()}`;
      $(".arrow", b).textContent = on ? (state.dir === "desc" ? "↓" : "↑") : "";
    });
    $("#cat-filter", el).value = state.cat;
    const note = $("#dup-note", el);
    note.hidden = !twins.size;
    note.setAttribute("aria-pressed", String(state.dup));
    note.innerHTML = `<span class="bang" aria-hidden="true">!</span>${state.dup ? "Show everything" : `${twins.size} possible duplicate${twins.size === 1 ? "" : "s"} — check`}`;
    wrap.innerHTML = `<ul class="tx-list" id="list">${list.slice(0, state.shown).map((t) => txRow(t, twins.get(t.id))).join("")
      || `<li class="small muted" style="padding:12px 0">${all.length ? "Nothing matches." : "No entries yet. Add the first one above."}</li>`}</ul>
      ${list.length > state.shown ? `<button class="btn ghost sm block" id="more">Show more (${list.length - state.shown} left)</button>` : ""}`;
    $("#more", wrap)?.addEventListener("click", () => { state.shown += PAGE; renderList(); });
    $$(".tx", wrap).forEach((li) => {
      const id = li.dataset.id;
      $("[data-cat]", li).addEventListener("change", async (e) => {
        const n = await s.fixCategory(id, e.target.value);
        toast(n ? `Saved. ${n} other payment(s) from the same place were fixed too.` : "Saved. FinPilot will remember this.");
      });
      $("[data-del]", li).addEventListener("click", async (e) => {
        const b = e.currentTarget;
        if (!b.classList.contains("confirm")) { b.classList.add("confirm"); b.textContent = "Delete?"; return setTimeout(() => { b.classList.remove("confirm"); b.textContent = "✕"; }, 3000); }
        await s.deleteTransaction(id);
        toast("Deleted.");
        money(el, app, state); // totals change too
      });
      const dup = $(".dup", li);
      if (!dup) return;
      const btn = $(".dup-btn", dup);
      const reveal = () => $(".dup-pop", dup).scrollIntoView({ block: "nearest", behavior: "smooth" }); // the question may open below the fold
      btn.addEventListener("click", () => { const open = dup.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); if (open) reveal(); });
      dup.addEventListener("mouseenter", reveal);
      btn.addEventListener("focus", reveal);
      $$("[data-dup]", dup).forEach((b) => b.addEventListener("click", async () => {
        const removed = await s.resolveDuplicate(id, b.dataset.dup === "same");
        toast(removed ? `Got it: one payment. The extra “${removed.description}” entry was removed.` : "Got it: two different payments, both kept.", 5000);
        money(el, app, state);
      }));
    });
  };
  const set = (patch) => { Object.assign(state, patch, { shown: PAGE }); renderList(); };
  let timer;
  $("#search", el).addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => set({ q: e.target.value }), 200); });
  $$("[data-type]", el).forEach((b) => b.addEventListener("click", () => set({ type: b.dataset.type })));
  $$("[data-sort]", el).forEach((b) => b.addEventListener("click", () =>
    set(b.dataset.sort === state.sort ? { dir: state.dir === "desc" ? "asc" : "desc" } : { sort: b.dataset.sort, dir: "desc" })));
  $("#cat-filter", el).addEventListener("change", (e) => set({ cat: e.target.value }));
  $("#dup-note", el).addEventListener("click", () => set({ dup: !state.dup }));
  renderList();

  $("#paypal", el).addEventListener("click", () => paypalSheet(app, () => money(el, app, state)));
}

// After a PayPal import: how many imported payments look like entries the family already has.
const dupHint = (s, before) => { const n = s.duplicates().length - before; return n > 0 ? ` ${n} look${n === 1 ? "s" : ""} like ${n === 1 ? "an entry" : "entries"} you already have: check the ! in History.` : ""; };

function paypalSheet(app, done) {
  const s = app.store, st = s.data.settings;
  if (paypalConnected(s)) {
    const box = sheet(`<div class="section-head"><h2>PayPal</h2><button class="btn ghost sm" id="close">Close</button></div>
      <p class="small">Connected as <b>${esc(st.paypal_name || st.paypal_email)}</b>${st.paypal_email ? ` (${esc(st.paypal_email)})` : ""}${st.paypal_connected_at ? ` since ${esc(st.paypal_connected_at)}` : ""}.${st.paypal_synced_at ? ` Last import: ${esc(st.paypal_synced_at)}.` : ""}</p>
      <div class="stack"><button class="btn primary block" id="sync">Import payments (last 90 days)</button><button class="btn danger block" id="disconnect">Disconnect</button></div>
      <p class="xs muted">Disconnect forgets this PayPal account on this computer. Payments already imported stay.</p>`, "PayPal");
    $("#close", box).addEventListener("click", closeSheet);
    $("#sync", box).addEventListener("click", (e) => busy(e.currentTarget, async () => {
      const before = s.duplicates().length;
      const r = await syncPaypal(s);
      closeSheet(); done(); toast(r.found ? `PayPal: ${r.found} payments found, ${r.imported} new.${dupHint(s, before)}` : "PayPal: no payments yet (new ones can take up to 3 hours to show).", 7000);
    }));
    $("#disconnect", box).addEventListener("click", async () => { await disconnectPaypal(s); closeSheet(); done(); toast("PayPal disconnected."); });
    return;
  }
  const box = sheet(`<div class="section-head"><h2>Connect PayPal</h2><button class="btn ghost sm" id="close">Cancel</button></div>
    <p class="small">Log in with your PayPal account on PayPal's own page. FinPilot never sees your password.</p>
    <ul class="steps small">
      <li>PayPal shares your <b>name and email</b> with FinPilot.</li>
      <li>FinPilot imports your payments made in shops that use FinPilot's PayPal (our Sandbox demo shop), and our ML sorts them into categories.</li></ul>
    <button class="btn paypal-login block" id="login">${LINK_ICON}Log in with PayPal</button>
    <p class="xs muted">Sandbox: test accounts and test money. Use a PayPal Sandbox personal account to log in.</p>`, "Connect PayPal");
  $("#close", box).addEventListener("click", closeSheet);
  $("#login", box).addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const before = s.duplicates().length;
    const who = await connectPaypal(s);
    const r = await syncPaypal(s).catch((err) => ({ error: err.message }));
    closeSheet(); done();
    toast(r.error ? `Connected as ${who.name}, but the import failed: ${r.error}`
      : r.found ? `Connected as ${who.name}: ${r.found} payments found, ${r.imported} new.${dupHint(s, before)}`
      : `Connected as ${who.name}. No payments through FinPilot's PayPal shop yet — PayPal shows new ones with up to a 3-hour delay. Use Import payments later.`, 9000);
  }));
}
