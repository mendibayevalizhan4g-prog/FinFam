# FinPilot Chrome extension (v4: built-in ML, no AI keys)

No server and no external AI. Our ML models run in the browser; the family's data stays in `chrome.storage.local`.

## Install
1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → choose this `extension/` folder.
2. Click the FinPilot icon: the **side panel** opens. **Try the demo family** (password **DEMO26**) or **Create a new family** (6 letters and digits; everyone in the family uses the same password).
3. Turn on **Shop check** (switch at the top of the panel, or right-click the toolbar icon → *Turn shop check on*; the icon shows **ON**). Product pages then show Worth it / Think about it / Not worth it. *Turn off* is on the card too.
4. Optional: **Money → Connect PayPal → Log in with PayPal** with a PayPal Sandbox personal account.
   `paypal.config.json` (our PayPal **Sandbox** app keys, test money only) is included, so this works after download.
   Developers who use their own Sandbox app: `python3 scripts/make_paypal_config.py` rewrites it from `.env`;
   in the Sandbox app turn on *Log in with PayPal* (Return URL `https://lakkaedhdeopfgfnpioemhplfomfgbam.chromiumapp.org/paypal`, scopes: name, email) and *Transaction Search*.
   The `key` in `manifest.json` fixes the extension ID, so this Return URL is the same on every computer.

## Files
| Path | What |
|---|---|
| `panel.html`, `panel.js`, `panel.css` | Side panel: family password lock, then two parts |
| `views/advisor.js` | Part 1, Advisor: this month, advice cards, Is it worth it?, left to spend, questions, goals |
| `views/money.js` | Part 2, Money: add expense/income (live ML category), monthly income added by itself, history with sorting, filters and fixes, a "!" on possible duplicates, Connect PayPal (Log in with PayPal) |
| `content.js`, `detect.js` | On shop pages: finds product and price (schema.org → meta tags → Amazon layout → microdata), shows the card |
| `background.js` | Runs the engine for the card; opens the panel; right-click “Is this worth it?” |
| `lib/` | Engine: `ml.js`, `market.js`, `features.js`, `finance.js`, `verdict.js`, `assistant.js`, `paypal.js`, `store.js`, `dates.js`, `ui.js` |
| `models/` | Trained models exported from Python (`ml/export_extension.py`, `ml/train_price_knn.py`) |
| `data/` | Demo family and test fixtures |
| `test.html` | 99 checks: the JS engine matches Python, plus monthly income, history sorting and the duplicate check (serve the folder over http and open `test.html?memory`) |
| `card-test.html` | Developer page: the on-page card on a test product (`?memory&title=...&price=...`) |

## Privacy
Nothing leaves the computer, except PayPal Sandbox requests when you connect PayPal. The family password is stored
only as a salted SHA-256 hash. Connecting PayPal stores only the person's name, email and PayPal ID (no tokens, no password);
Disconnect forgets them.

This project is a prototype and is not financial advice.
