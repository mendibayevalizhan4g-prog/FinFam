// FinPilot side panel: the family password lock, then exactly two parts: Advisor and Money.
import { loadModels } from "./lib/ml.js";
import { MarketIndex } from "./lib/market.js";
import { DEMO_PASSWORD, Store, generatePassword, normalizePassword, validPassword } from "./lib/store.js";
import { todayStr } from "./lib/dates.js";
import { $, $$, busy, closeSheet, esc, formData, sheet, toast } from "./lib/ui.js";
import { advisor } from "./views/advisor.js";
import { money } from "./views/money.js";

const root = $("#root");

// "Shop check": show Worth it / Not worth it on shop pages. A device setting (not per family), off until turned on.
const CARD_KEY = "finpilot:card_on";
const cardSetting = globalThis.chrome?.storage?.local
  ? { get: async () => (await chrome.storage.local.get(CARD_KEY))[CARD_KEY] === true,
      set: (on) => chrome.storage.local.set({ [CARD_KEY]: on }),
      watch: (fn) => chrome.storage.onChanged.addListener((c, area) => { if (area === "local" && c[CARD_KEY]) fn(c[CARD_KEY].newValue === true); }) }
  : { get: async () => localStorage.getItem(CARD_KEY) === "1", set: async (on) => localStorage.setItem(CARD_KEY, on ? "1" : "0"), watch: () => {} };
cardSetting.watch((on) => $("#card-toggle")?.setAttribute("aria-checked", String(on)));
const TABS = { advisor: ["Advisor", advisor], money: ["Money", money] };
const app = { models: null, market: null, marketReady: null, store: null, today: todayStr(), tab: "advisor",
  refresh: () => renderTab(), go: (tab) => { app.tab = tab; renderShell(); } };

// The market price database (66k products) is indexed once, after the first screen is shown.
function loadMarket() {
  app.marketReady ||= new Promise((r) => setTimeout(r, 200))
    .then(() => fetch("models/price_index.json")).then((r) => r.json()).then((spec) => { app.market = new MarketIndex(spec); });
  return app.marketReady;
}

// ------------------------------------------------------------------ lock screen

function renderLock() {
  root.innerHTML = `
    <div class="center lock">
      <div class="brand"><span class="logo lg" aria-hidden="true">F</span><b>FinPilot</b></div>
      <h1>Your family's money advisor</h1>
      <p class="muted small">Built-in ML checks every purchase against your family budget and market prices. No AI keys, and your data stays on this computer.</p>
      <form id="open" class="section stack" novalidate>
        <label class="field">Family password
          <input class="input code" name="password" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" required aria-describedby="pw-help">
        </label>
        <span id="pw-help" class="xs muted">Everyone in the family uses the same 6-character password.</span>
        <button class="btn primary block">Open</button>
      </form>
      <div class="or" role="separator"><span>or</span></div>
      <div class="stack">
        <button class="btn ghost block" id="new">Create a new family</button>
        <button class="btn ghost block" id="demo">Try the demo family</button>
        <p class="xs muted" style="text-align:center;margin:0">Demo password: <b class="code-inline">${DEMO_PASSWORD}</b> · the Carters, 2 parents and 2 teens</p>
      </div>
    </div>`;
  const input = $("#open input");
  input.focus();
  input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
  $("#open").addEventListener("submit", (e) => {
    e.preventDefault();
    const pw = normalizePassword(input.value);
    if (pw.length !== 6) { toast("The password has 6 letters and digits."); return input.focus(); }
    busy(e.submitter, async () => { await app.store.unlock(pw); start(); });
  });
  $("#demo").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const demo = await (await fetch("data/demo_family.json")).json();
    await app.store.loadDemo(demo, app.today);
    start();
  }));
  $("#new").addEventListener("click", newFamily);
}

function newFamily() {
  const box = sheet(`
    <div class="section-head"><h2>New family</h2><button class="btn ghost sm" id="cancel">Cancel</button></div>
    <form id="create" class="stack" novalidate>
      <label class="field">Family name<input class="input" name="name" required placeholder="The Smiths"></label>
      <label class="field">Children living at home
        <select class="select" name="children">${[0, 1, 2, 3, 4, 5].map((n) => `<option ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}</select>
      </label>
      <div class="field"><span id="np-label">Family password</span>
        <div class="pw-row"><input class="input code" name="password" maxlength="6" value="${generatePassword()}" aria-labelledby="np-label" aria-describedby="np-help" autocomplete="off" spellcheck="false">
          <button type="button" class="btn ghost" id="regen">New</button></div>
        <span id="np-help" class="xs muted">6 letters and digits, at least one of each. Write it down: it can't be recovered. Everyone in the family opens FinPilot with it.</span>
      </div>
      <button class="btn primary block">Create family</button>
    </form>`, "New family");
  const pw = $("[name=password]", box);
  pw.addEventListener("input", () => { pw.value = pw.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); });
  $("#regen", box).addEventListener("click", () => { pw.value = generatePassword(); });
  $("#cancel", box).addEventListener("click", closeSheet);
  $("#create", box).addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (!f.name.trim()) return toast("Name your family.");
    if (!validPassword(normalizePassword(f.password))) return toast("Password: exactly 6 letters and digits, with at least one of each.");
    busy(e.submitter, async () => {
      await app.store.createFamily(f.name, f.password, Number(f.children));
      closeSheet();
      app.tab = "money";
      start();
      toast(`Family created. Password ${normalizePassword(f.password)} — write it down.`, 8000);
    });
  });
}

// ------------------------------------------------------------------ shell with two parts

function renderShell() {
  const fam = app.store.data.family;
  root.innerHTML = `
    <header class="topbar">
      <span class="logo" aria-hidden="true">F</span>
      <div class="who"><div class="family">${esc(fam.name)}</div><div class="sub">${fam.is_demo ? "Demo family · " : ""}prototype, not financial advice</div></div>
      <button class="switch" role="switch" id="card-toggle" aria-checked="false" title="Show Worth it / Not worth it on shop pages"><span class="track" aria-hidden="true"><span class="knob"></span></span>Shop check</button>
      <button class="btn ghost sm" id="lock" title="Lock: the family password is needed again">Lock</button>
    </header>
    <div class="tabs" role="tablist" aria-label="FinPilot">${Object.entries(TABS).map(([id, [label]]) =>
      `<button role="tab" id="tab-${id}" aria-controls="view" aria-selected="${id === app.tab}" tabindex="${id === app.tab ? 0 : -1}">${label}</button>`).join("")}</div>
    <main id="view" role="tabpanel" aria-labelledby="tab-${app.tab}" tabindex="-1"></main>`;
  $("#lock").addEventListener("click", async () => { await app.store.lock(); app.tab = "advisor"; renderLock(); });
  const sw = $("#card-toggle");
  cardSetting.get().then((on) => sw.setAttribute("aria-checked", String(on)));
  sw.addEventListener("click", async () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(on));
    await cardSetting.set(on);
    toast(on ? "Shop check is on: open a product page and FinPilot shows Worth it / Not worth it." : "Shop check is off.");
  });
  const tabs = $$("[role=tab]");
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => app.go(t.id.slice(4)));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      app.go(next.id.slice(4));
      $(`#${next.id}`).focus();
    });
  });
  renderTab();
}

async function renderTab() {
  const el = $("#view");
  if (!el) return;
  el.innerHTML = `<div class="skeleton" style="height:22px;width:50%"></div><div class="skeleton" style="height:90px;margin-top:12px"></div>`;
  el.classList.remove("enter");
  try {
    await TABS[app.tab][1](el, app);
    void el.offsetWidth; el.classList.add("enter"); // sections rise in once per tab switch, not on every redraw
    clearTimeout(renderTab.timer);
    renderTab.timer = setTimeout(() => el.classList.remove("enter"), 1200);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="section" role="alert"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`;
    $("#retry").addEventListener("click", renderTab);
  }
}

// Monthly income (salary) is added on pay day, including the months when FinPilot was not opened.
async function catchUpIncome() {
  app.today = todayStr();
  const n = await app.store.applyRecurringIncome(app.today).catch(() => 0);
  if (n) toast(`Monthly income: ${n} payment${n === 1 ? "" : "s"} added to the history.`, 5000);
  return n;
}

async function start() {
  if (!app.store.ready) return renderLock();
  await catchUpIncome();
  renderShell();
  loadMarket();
}

(async () => {
  app.models = await loadModels("");
  app.store = new Store(app.models);
  await app.store.resume();
  await start();
})().catch((e) => { root.innerHTML = `<div class="center" role="alert"><h1>FinPilot could not start</h1><p class="muted">${esc(e.message)}</p></div>`; });

// The on-page card may add data (Postpone); show it when the panel comes back into view.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !app.store?.ready) return;
  const key = app.store.key, rev = app.store.data.rev;
  if (!(await app.store.resume())) return renderLock();
  if (app.store.key !== key) return renderShell(); // another family was opened elsewhere
  await catchUpIncome();
  if (app.store.data.rev !== rev && !$(".sheet-bg") && !document.activeElement?.matches("input, select, textarea")) renderTab();
});
