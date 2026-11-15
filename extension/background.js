// FinPilot background worker: runs the same built-in engine as the side panel for the on-page card.
// No server and no external AI: models are files inside the extension, data is chrome.storage.local.
import { loadModels } from "./lib/ml.js";
import { MarketIndex } from "./lib/market.js";
import { Store } from "./lib/store.js";
import { todayStr } from "./lib/dates.js";
import { checkPurchase } from "./lib/verdict.js";

let enginePromise = null;
function engine() {
  enginePromise ||= (async () => {
    const base = chrome.runtime.getURL("");
    const [models, spec] = await Promise.all([loadModels(base), fetch(`${base}models/price_index.json`).then((r) => r.json())]);
    return { models, market: new MarketIndex(spec) };
  })();
  return enginePromise;
}

async function app() {
  const { models, market } = await engine();
  const store = new Store(models);
  await store.resume(); // always fresh: the panel may have changed the data
  if (!store.ready) throw new Error("Open FinPilot (toolbar icon) and enter your family password first.");
  return { models, market, store, today: todayStr() };
}

const ROUTES = {
  async check(msg) { return checkPurchase(await app(), msg.product); },
  async postpone(msg) { const a = await app(); return { remind_on: await a.store.postpone(msg.product) }; },
  async openPanel(msg, sender) { await chrome.sidePanel.open({ tabId: sender.tab.id }); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const route = ROUTES[msg?.type];
  if (!route) return false;
  route(msg, sender).then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// Shop check on/off: right-click the toolbar icon; the icon shows ON while it is on.
const CARD_KEY = "finpilot:card_on";
async function paintCardState() {
  const on = (await chrome.storage.local.get(CARD_KEY))[CARD_KEY] === true;
  chrome.action.setBadgeText({ text: on ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#12885f" });
  chrome.contextMenus.update("finpilot-card-toggle", { title: on ? "Turn shop check off" : "Turn shop check on" }, () => void chrome.runtime.lastError);
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[CARD_KEY]) paintCardState(); });
chrome.runtime.onStartup.addListener(paintCardState);

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({ id: "finpilot-check", title: "Is this worth it? (FinPilot)", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "finpilot-card-toggle", title: "Turn shop check on", contexts: ["action"] }, paintCardState);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "finpilot-check" && tab?.id) chrome.tabs.sendMessage(tab.id, { type: "checkSelection", text: info.selectionText || "" });
  if (info.menuItemId === "finpilot-card-toggle") {
    const on = (await chrome.storage.local.get(CARD_KEY))[CARD_KEY] === true;
    await chrome.storage.local.set({ [CARD_KEY]: !on });
  }
});
