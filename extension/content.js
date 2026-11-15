// FinPilot on shop pages: finds the product (or uses your selection), asks the built-in engine, shows the verdict:
// first Worth it / Think about it / Not worth it, then the family's money this month, then the market average from our database.
(function () {
  if (window.__finpilotLoaded) return;
  window.__finpilotLoaded = true;

  const D = {
    buy: { icon: "✓", color: "#0f7a55", bg: "#e6f6ef", line: "#b5e3cf" },
    think: { icon: "?", color: "#a35a06", bg: "#fff4dc", line: "#f6dba0" },
    not_worth_it: { icon: "✕", color: "#b92d45", bg: "#fdecef", line: "#f6c1ca" },
  };
  const money = (x, d = 0) => "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Shop check on/off (side panel switch, toolbar icon menu, or "Turn off" on the card). Off until the user turns it on.
  const CARD_KEY = "finpilot:card_on";
  let enabled = false;
  let root, lastKey = null, product = null, verdict = null, hideTimer = null;
  const removeBox = () => { if (root) { root.host.remove(); root = null; } lastKey = null; };

  function send(msg) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false, error: "No answer from FinPilot" })); }
      catch (e) { resolve({ ok: false, error: "The extension was reloaded. Refresh this page." }); }
    });
  }

  function box() {
    if (!root) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
      document.documentElement.appendChild(host);
      root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        *{box-sizing:border-box;font-family:"Segoe UI Variable Text","Segoe UI",Inter,system-ui,-apple-system,sans-serif;margin:0}
        @keyframes fp-in{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.pill,.card{animation:none!important}}
        .pill{display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#18235c,#2a3fae);color:#fff;border:none;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 10px 30px rgba(17,26,54,.35);animation:fp-in .3s cubic-bezier(.2,.8,.2,1) both;transition:transform .15s}
        .pill:hover{transform:translateY(-1px)}
        .dot{width:18px;height:18px;border-radius:999px;display:inline-grid;place-items:center;font-size:11px;font-weight:800;color:#fff}
        .card{width:340px;background:#fff;color:#111a36;border-radius:18px;box-shadow:0 18px 50px rgba(17,26,54,.28);border:1px solid #e1e6f2;animation:fp-in .35s cubic-bezier(.2,.8,.2,1) both;overflow:hidden;font-size:14px;line-height:1.45}
        .head{padding:12px 14px;display:flex;gap:10px;align-items:center}
        .icon{width:34px;height:34px;border-radius:999px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:16px;flex:none}
        .verdict{font-weight:800;font-size:20px;line-height:1.15}
        .item{color:#475569;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}
        .x{margin-left:auto;align-self:flex-start;border:none;background:transparent;font-size:18px;color:#64748b;cursor:pointer;line-height:1;padding:2px 4px}
        .body{padding:12px 14px;display:grid;gap:8px}
        .family{font-weight:600}
        .why{color:#334155;font-size:13px}
        .market{background:#f3f5fb;border-radius:10px;padding:8px 10px;display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:0 8px}
        .market b{font-size:17px}.market .l{font-size:12px;color:#64748b}.market .s{grid-column:1/-1;font-size:12px;color:#64748b}
        .fair{font-size:13px;font-weight:600}
        .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
        .main{background:#2f4fd8;color:#fff;border:none;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background .18s}
        .main:hover:not(:disabled){background:#2139a8}
        .sec{background:#fff;color:#111a36;border:1px solid #c9d3fa;border-radius:10px;padding:7px 11px;font-size:13px;cursor:pointer;transition:background .18s}
        .sec:hover{background:#e9edfd}
        .main:disabled{opacity:.7;cursor:default}
        .foot{padding:7px 14px;font-size:11px;color:#64748b;border-top:1px solid #f1f5f9}
        .foot a{color:#2139a8;font-weight:600;text-decoration:underline;cursor:pointer}
        button:focus-visible{outline:2px solid #2f4fd8;outline-offset:2px}
      </style><div id="box"></div>`;
    }
    return root.getElementById("box");
  }

  const pill = (html, onClick) => {
    box().innerHTML = `<button class="pill" id="p">${html}</button>`;
    if (onClick) box().querySelector("#p").addEventListener("click", onClick);
  };
  const dot = (d) => `<span class="dot" style="background:${D[d].color}" aria-hidden="true">${D[d].icon}</span>`;

  function showError(error) {
    pill("FinPilot · open to check", () => {
      box().innerHTML = `<div class="card" role="dialog" aria-label="FinPilot"><div class="head"><div><div class="verdict" style="font-size:16px">FinPilot can't check yet</div><div class="item">${esc(error)}</div></div><button class="x" id="x" aria-label="Close">×</button></div>
        <div class="body"><div class="why">Click the FinPilot icon in the toolbar and enter your family password (or try the demo family, DEMO26). Then refresh this page.</div>
        <div class="row"><button class="main" id="open">Open FinPilot</button></div></div></div>`;
      box().querySelector("#x").addEventListener("click", () => showError(error));
      box().querySelector("#open").addEventListener("click", () => send({ type: "openPanel" }));
    });
  }

  function showCard() {
    const v = verdict, d = D[v.decision], e = v.explain, m = e.market;
    const vs = m && m.average != null ? (Math.abs(m.diff) < 0.05 ? "this price is about average" : `this price is ${Math.round(Math.abs(m.diff) * 100)}% ${m.diff > 0 ? "above" : "below"}`) : "";
    box().innerHTML = `
      <div class="card" role="dialog" aria-label="FinPilot: ${esc(v.title_text)}">
        <div class="head" style="background:${d.bg};border-bottom:1px solid ${d.line}">
          <span class="icon" style="background:${d.color}" aria-hidden="true">${d.icon}</span>
          <div style="min-width:0"><div class="verdict" style="color:${d.color}">${esc(v.title_text)}</div>
            <div class="item">${money(product.price, 2)} · ${esc(product.title || "This item")}</div></div>
          <button class="x" id="min" aria-label="Minimize">–</button>
        </div>
        <div class="body">
          <div class="family">${esc(e.family)}</div>
          ${e.why ? `<div class="why">${esc(e.why)}</div>` : ""}
          ${m && m.average != null ? `<div class="market"><span class="l">Average market price</span><b>${money(m.average)}</b><span class="s">${vs} · similar items ${money(m.low)}–${money(m.high)} · our database, 2023 prices</span></div>`
            : m ? `<div class="why" style="font-size:12px;color:#64748b">${esc(m.text)}</div>` : ""}
          ${e.fair ? `<div class="fair">${esc(e.fair)}</div>` : ""}
          <div class="row">
            ${v.decision !== "buy" ? `<button class="main" id="postpone">Postpone</button>` : ""}
            <button class="sec" id="open">Open FinPilot</button>
            <button class="sec" id="dismiss">${v.decision === "buy" ? "OK" : "Close"}</button>
          </div>
        </div>
        <div class="foot">FinPilot · built-in ML on your family's data · prototype, not financial advice · <a id="off" href="#" role="button">Turn off</a></div>
      </div>`;
    const $ = (s) => box().querySelector(s);
    const collapse = () => pill(`${dot(v.decision)} FinPilot · ${esc(v.title_text)}`, showCard);
    $("#off").addEventListener("click", (e) => { e.preventDefault(); turnOff(); });
    $("#min").addEventListener("click", collapse);
    $("#dismiss").addEventListener("click", collapse);
    $("#open").addEventListener("click", () => send({ type: "openPanel" }));
    $("#postpone")?.addEventListener("click", async () => {
      const r = await send({ type: "postpone", product: { ...product, category: v.category, decision: v.decision, probability: v.risk_after } });
      $("#postpone").textContent = r.ok ? `Postponed ✓ reminder ${r.data.remind_on}` : "Could not save";
      $("#postpone").disabled = true;
    });
  }

  async function check(p) {
    product = p;
    pill("FinPilot · checking your budget and market prices…");
    const r = await send({ type: "check", product: { title: p.title, price: p.price, url: p.url } });
    if (!r.ok) return showError(r.error);
    verdict = r.data;
    showCard();
  }

  function turnOff() {
    removeBox();
    try { chrome.storage.local.set({ [CARD_KEY]: false }); } catch (e) { /* extension reloaded */ }
  }

  function scan(announce = false) {
    if (!enabled) return;
    const p = window.FinPilotDetect.detectProduct(document);
    if (!p && announce) {
      pill("FinPilot is on · no product with a price on this page");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!product) removeBox(); }, 4000);
    }
    const key = p ? `${location.href}|${p.price}` : null;
    if (!p || key === lastKey) return;
    lastKey = key;
    check(p);
  }

  function fromSelection(text) {
    const price = window.FinPilotDetect.parsePrice(text);
    if (!price) return null;
    const title = text.replace(/(US)?\$\s?\d[\d.,]*|\d[\d.,]*\s?(USD|dollars)/gi, " ").replace(/\s+/g, " ").trim();
    return { title: title.length >= 3 ? title.slice(0, 160) : document.title, price, url: location.href };
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "getProduct") sendResponse({ product: window.FinPilotDetect.detectProduct(document), url: location.href, title: document.title });
    else if (msg.type === "checkSelection") { const p = fromSelection(msg.text); if (p) check(p); else pill("FinPilot · no price in the selection"); }
    else if (msg.type === "checkManual") check(msg.product);
    return false;
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[CARD_KEY]) return;
      enabled = changes[CARD_KEY].newValue === true;
      if (enabled) { lastKey = null; product = null; scan(true); } else removeBox();
    });
    chrome.storage.local.get(CARD_KEY).then((v) => {
      enabled = v[CARD_KEY] === true;
      scan();
      setTimeout(scan, 1500);
      setTimeout(scan, 4000);
    });
  } catch (e) { /* extension reloaded: this old copy stays quiet */ }
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; lastKey = null; setTimeout(scan, 1200); } }, 1000);
})();
