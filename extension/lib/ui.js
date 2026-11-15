// Small UI helpers shared by the side panel views.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (x, d = 0) => (x < 0 ? "−$" : "$") + Math.abs(Number(x) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (p) => (p == null ? "—" : `${Math.round(p * 100)}%`);
export const shortDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const dayLabel = (s) => new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const COLORS = ["#2f4fd8", "#12885f", "#be185d", "#c97a12", "#0369a1"];
export const avatar = (name, i, cls = "") => `<span class="avatar ${cls}" style="background:${COLORS[i % COLORS.length]}" aria-hidden="true">${esc((name || "?")[0])}</span>`;

export const LIGHT = { red: ["red", "High risk"], yellow: ["amber", "Watch"], green: ["green", "On track"] };
export const DECISION = { buy: ["green", "Buy"], think: ["amber", "Think about it"], not_worth_it: ["red", "Not worth it"] };
export const BAR = { red: "var(--red)", yellow: "var(--amber)", green: "var(--green)" };

export function toast(text, ms = 3500) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text;
  t.hidden = false;
  t.classList.remove("show"); void t.offsetWidth; t.classList.add("show"); // restart the slide-in
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// Bottom sheet dialog; returns the sheet element. Esc or backdrop click closes it.
export function sheet(html, label) {
  closeSheet();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
  document.addEventListener("keydown", escClose);
  document.body.append(bg);
  bg.querySelector("input, select, button")?.focus();
  return bg.querySelector(".sheet");
}
function escClose(e) { if (e.key === "Escape") closeSheet(); }
export function closeSheet() { $(".sheet-bg")?.remove(); document.removeEventListener("keydown", escClose); }

export async function busy(btn, fn) {
  if (!btn) { try { return await fn(); } catch (e) { toast(e.message); } return; } // form sent without a button (Enter in some browsers)
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Working…";
  try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}

export const formData = (form) => Object.fromEntries(new FormData(form));
