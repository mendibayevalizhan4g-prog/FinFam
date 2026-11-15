# FinPilot

**A Chrome extension that tells a family whether a purchase fits their budget, before they click Buy.**

Built for the Veritas AI High School Hackathon 2026 (AI + Finance track).

> This project is a prototype and is not financial advice.

On a product page, FinPilot adds a small card with one of three verdicts: Worth it, Think about it or Not worth it. Under the verdict it shows how much money the family has left in that category this month, the chance of overspending, and the average market price of similar products.

For example, concert tickets at $100 this month get a Not worth it. The family has $57 left for entertainment, the model's chance of overspending jumps from 20% to 100%, and a price that fits right now is about $16.

Everything runs inside Chrome. There is no server and there are no AI keys. The models are ours, trained on public data and shipped with the extension.

## Results in one table

We tested on families the models had never seen. With the same number of warnings, FinPilot avoids more overspending than the popular 50/30/20 rule.

| | Avoided per family per month |
|---|---|
| 50/30/20 rule | $201 |
| FinPilot | $285 |

The test covers 4,033 online purchases from 83 families. The family data is synthetic, so real families may behave differently (see "Where it fails").

## Try it

1. Download this repository (Code, then Download ZIP) and unzip it, or run `git clone`.
2. In Chrome, open `chrome://extensions`, switch on Developer mode, click Load unpacked and choose the `extension/` folder.
3. Click the FinPilot icon. The side panel opens. Choose "Try the demo family" (password `DEMO26`) or "Create a new family".
4. Turn on **Shop check** with the switch at the top of the panel (or right-click the FinPilot icon). The card is off until you do.
5. Open any product page, for example on Amazon, and the card appears. You can also select a product and a price, right-click, and choose "Is this worth it?".
6. Optional: connect PayPal under Money, then Connect PayPal, using a PayPal Sandbox personal account.

The PayPal setup for developers is in the section "Developer notes" below.

## The problem

Families decide about money one purchase at a time, in a shop, often a teen with a phone. The budget sits in a spreadsheet nobody opens at checkout. Budget apps only show what already happened, and the decision that matters comes before the click on Buy.

We built FinPilot for US families. The demo family is the Carters: two parents and two teens.

## What FinPilot does

**On the product page.** The card gives the verdict first. Then it shows the money left in the category this month, what the family usually spends by month end, the ML risk forecast, the average market price from our database, and a price that fits now. "Postpone" saves the item with a reminder.

**In the Advisor tab.** It shows the month so far (spent, income, kept). Right under it is the chat: quick questions sit in one line of buttons, and answers appear in a window of fixed height, so the page does not grow. Only the latest answer is open, earlier ones fold into one line each, and "Clear" empties the chat. "What can I buy?" answers with the largest amount per category that keeps our overspend model under its warning level, and "Can I buy sneakers?" without a price uses the average price from our market database. Below the chat are the advice cards (a category likely to go over, bills due this week, what grew last month, goals that are behind), "Is it worth it?" for any item, what is left to spend per category, and goals.

**In the Money tab.** The family adds expenses and income, and the model picks the category while you type. You can fix a category, and one fix re-labels every payment from that merchant.

- **Monthly income.** You write your pay once (name, amount, pay day). FinPilot adds it to the history every month on pay day, and catches up on the months when the extension was not opened. "+ Add job" adds a second income next to the first.
- **History you can sort.** Three buttons sort by date, amount or type, and a second press flips the direction (newest or oldest first, largest or smallest first, income or expenses first). You can also show only money in or money out, pick one category, or search.
- **PayPal.** With Connect PayPal, the user logs in on PayPal's own page and FinPilot imports payments made through our PayPal shop over the last 90 days.
- **No double counting.** If an imported PayPal payment has the same amount as an entry already in the history within 3 days (for example, the monthly income), FinPilot does not delete anything. It puts a small "!" next to the entry. Hover or tap it and FinPilot asks whether it is the same money. "Yes" keeps one entry, "No" keeps both and never asks again.

**Family password.** The whole family opens the same data with one 6-character password. We store only a salted hash, and each family sees only its own data.

**Look.** The panel uses deep blue as the brand color, so green, amber and red stay reserved for the three verdicts. It follows the system light or dark theme, and its short animations switch off for people who ask their system for less motion.

## Results in detail

All numbers come from test data the models never saw.

**Overspend risk.** We trained on 2025, set the threshold on Jan–Mar 2026 and tested on Apr–Sep 2026 (17,030 cases).

| Method | Precision | Recall | PR-AUC |
|---|---|---|---|
| Proportion "spent × 30/day" | 0.686 | 0.676 | 0.754 |
| Pace "spent + what usually comes later" | 0.677 | 0.742 | 0.742 |
| Our model | 0.774 | 0.690 | 0.853 |

**Verdict backtest.** We took every online purchase of $20 or more in Apr–Sep 2026 (4,033 purchases, 83 families). Each method postpones the same share of purchases, 17%.

| Method | $ overspend avoided / family / month | Precision | False alarms |
|---|---|---|---|
| 50/30/20 rule | $201 | 0.63 | 256 |
| Proportion rule | $232 | 0.82 | 126 |
| Overspend model alone | $286 | 0.99 | 4 |
| FinPilot verdict | $285 | 0.66 | 236 |

**Why we do not ship the overspend model alone.** In this table it looks better: the same dollars with 4 false alarms instead of 236. The reason is how the backtest scores a warning. A warning counts as right only if the category ends the month more than 10% over its usual level. The model answers exactly that question. The verdict also asks whether the item itself is unusually expensive for this family (the "usual price" rule, 486 of the 696 warnings). Such a warning is scored as a false alarm whenever the month ends fine, even if the item cost far more than the family usually pays. Two more parts of the verdict, the market price and the family's goals, cannot be backtested at all: bank lines have no product titles and the dataset has no goals. So the table measures the verdict only on the one question where the model alone is enough. We keep the verdict because a family also wants to hear "this is overpriced" and "this delays your goal", and we report the cost honestly.

**Verdict balance.** "Think about it" judges the purchase, not the month: the purchase itself must add 2 or more points of overspend risk, or cross the warning level. Before this change, a category already likely to go over made almost everything "Think". On 200 random Amazon items for the demo family (Shopping already at 85% risk), Worth it went from 1.5% to 36%, Think from 79.5% to 45%, and Not worth it stayed at 19%. In the backtest "Think" fell from 21% to 10% of purchases. The headline numbers above count only "Not worth it" and did not change.

**Market price.** We tested on 7,277 products from stores that are not in the training data.

| Method | Median error | Within ±25% |
|---|---|---|
| Category median | 53.6% | 24% |
| Ridge on titles | 37.1% | 36% |
| kNN search (the one we use) | 33.5% | 38% |

Gemini estimated prices better (25.8% error on 100 products), but it needs an API key, so the extension does not use it. The card shows a market price only when the listed price is within 3× of the similar items' range. That keeps 96% of test products (error 32.7%). The hidden 4% had an 88.6% error, mostly accessories with the same name as the main product.

**Recurring payments** (30% of families held out). The rule "3+ times in 3+ months" scores F1 0.278, our model 0.966. Next payment within ±3 days: 96% for our model, 84% for "last + 30 days".

**Categorization** (50 held-out families, macro-F1). Keywords score 0.650, our compact model 0.696, and 0.836 after 200 user corrections.

**Advisor topics.** The model in the extension, before and after we added the "What can I buy?" skill and grew the training set from 612 to 992 phrases. Both test sets were written before the change and never trained on.

| Test | Keywords | Before | After | After: right answer or right button |
|---|---|---|---|---|
| 40 new questions | 37.5% | 60% | 77.5% | 87.5% (was 75%) |
| 20 fresh questions | 30% | 60% | 65% | 75% (was 75%) |

`ml/train_intent.py` refuses to train if a test question is in the training phrases or nearly copied (character similarity of 0.95 or more). We no longer report the older 47-question set because the added training phrases now overlap with it.

## How it works

```
 Chrome extension (no server, no AI keys)
 ┌──── side panel ────┐            ┌── any shop page ──┐
 │ lock → Advisor │ Money│            │ detect.js + card  │
 └─────────┬──────────┘            └────────┬──────────┘
           │          background worker ◄───┘
           ▼                  ▼
   lib/ engine (same ES modules in both)
   ml.js       TF-IDF + logistic/ridge, gradient-boosted trees (from JSON)
   market.js   kNN search in 66k Amazon products (2023 prices)
   features.js live overspend features, recurring series
   finance.js  month summary, free cash, goals, upcoming bills
   verdict.js  decision rules + fitting price + short explanation
   assistant.js intent model → our tools
   store.js    family data in chrome.storage.local (password hash),
               monthly income, possible duplicates
   paypal.js   Log in with PayPal (chrome.identity) + Transaction Search
```

We trained six ML parts ourselves and tested each against simple baselines (and against Gemini where we could). We also backtested the decision itself in dollars, not only the model metrics. All models were exported from Python and ported to JavaScript, then checked number for number. `extension/test.html` runs 83 automated checks, including 1,536 verdict-rule cases, the market search, the monthly income, the history sorting and the duplicate check.

| # | Model | Data | Method |
|---|---|---|---|
| 1 | Categorization | Train: DoDataThings (68k synthetic bank lines). Test: Misata families (different generator) | TF-IDF (chars + words) + logistic regression (compact: 28k features) |
| 2 | Recurring payments | Misata labels of recurring streams | Series features + gradient boosting; next date from the usual gap |
| 3 | Overspend risk | Misata, 100 families × 24 months | Gradient boosting, monotonic in spending, live features for any day of the month |
| 4 | Market price | Amazon Products 2023 (66k training products) | k nearest neighbours by title (TF-IDF cosine, k = 10): similarity-weighted median and 25–75% range |
| 5 | Verdict | Outputs of 2–4 + family's usual prices + goals + needs/wants | Team rules (`docs/spec.md`); fitting price = highest price keeping the risk under the model's warning threshold |
| 6 | Advisor topics | 992 template phrases (9 topics) | TF-IDF + logistic regression; unsure (p < 0.6) → 2 more topics as buttons. Answers are computed by models 2–5 |

The advisor works offline. Our intent model and our money code answer questions, and when the model is unsure it offers the next likely topics as buttons.

## Where it fails

- **Synthetic data.** The family bank data is synthetic (Misata), and we generated the teens' spending ourselves. The recurring-payment scores are probably too optimistic.
- **Market price by title can be fooled.** Take a Sony WH-1000XM5 at $348. The database has the exact model ($398) and the XM4 ($348), but cheaper Sony headphones among the 10 neighbours pull the average down to $98, so the card says "255% above". For AirPods Pro at $249, the nearest titles are $10 cases, so the 3× rule hides the market price. Sharper similarity weights did not help on validation (34.2% went to 34.6–40%). The prices are from 2023.
- **The advisor still misses 1 in 4 or 5 free-text questions** (77.5% and 65% right). "Which category is most at risk" is read as where we lose money, "howdy" as spending, and "anything I parked for later?" as "is it worth it". That is why the main actions are buttons, and the advisor shows how it understood each question.
- **The "usual price" rule trades precision for dollars.** It flags expensive items even in months that end fine.
- **Big purchases get missed.** A $542 Amazon purchase in mid-month looked low risk (36%), and spending in the month tripled later.
- **Categorization mistakes.** Credit-card interest was read as Entertainment and T-Mobile as Transport. One click fixes it, and the fix spreads to the same merchant. A $1,200 PayPal "Salary" was once read as Shopping and counted as negative spending. Now money that surely came in (PayPal receipts, entries marked Income) counts as income. We do not apply that rule to bank lines, where many shopping refunds are positive, and a general rule lowered the test macro-F1 (0.6961 to 0.6953).
- **The duplicate check is simple.** It compares the amount and the date (within 3 days) and nothing else. Two different payments of the same amount in the same week get a "!" too, which is why FinPilot asks and never deletes on its own. A payment that PayPal reports more than 3 days away from the entry is not caught.
- **Monthly income is a fixed amount.** Pay that changes from month to month has to be corrected by hand.
- **One computer.** A family's data lives in one browser. Syncing across devices needs a server, which is our next step.
- **PayPal shows only part of a person's spending.** PayPal gives third-party apps a person's name and email, not their whole payment history. So FinPilot imports only payments made through our own PayPal shop (Sandbox, test money). Full history would need a paid bank-data aggregator or PayPal partner approval. Because there is no server, our Sandbox app's PayPal secret is published in this repository on purpose (test money only). A real product would exchange the login code on a server.

## What's next

- Test FinPilot with real, consented family data and retrain on it
- Connect real bank accounts (open banking)
- Sync a family's data across devices
- Fresher price data
- Parent approval for teen purchases

## Developer notes

Connect PayPal works right after download: `extension/paypal.config.json` holds our PayPal Sandbox app keys (test money only). To use your own Sandbox app, run `python3 scripts/make_paypal_config.py`, which rewrites that file from `.env`. In the PayPal Sandbox app, turn on Log in with PayPal and Transaction Search, and set the Return URL to `https://lakkaedhdeopfgfnpioemhplfomfgbam.chromiumapp.org/paypal`.

Engine tests: serve `extension/` over http (`python3 -m http.server`) and open `test.html?memory` (83 checks) or `card-test.html?memory` (the card on a test product page).

To retrain and re-export the models, run `pip install -r requirements.txt`, then `python ml/data_prep.py`, the `ml/train_*.py` scripts, and `python ml/export_extension.py`. The results notebook is `notebooks/FinPilot_results.ipynb`.

This extension is the fourth version of FinPilot. An earlier version was a website with a server, and its code is kept in `backend/` and `web/`. It is not needed to run the extension.

## Data, tools and credits

Data:
- Misata, *US Bank and Card Transactions (preview)*, CC BY 4.0: https://huggingface.co/datasets/misatadata/us-bank-transactions
- DoDataThings, *US Bank Transaction Categories v2*, MIT: https://huggingface.co/datasets/DoDataThings/us-bank-transaction-categories-v2
- *Amazon Products 2023* (milistu), MIT, derived from McAuley Lab Amazon Reviews 2023: https://huggingface.co/datasets/milistu/AMAZON-Products-2023
- PayPal Sandbox (test accounts): https://developer.paypal.com

Models and libraries: scikit-learn (logistic regression, ridge, gradient boosting, TF-IDF), pandas and NumPy. The extension itself is plain JavaScript with no external libraries.

AI tools: we used the Google Gemini API (`gemini-3.5-flash`, `gemini-3.5-flash-lite`) only as an evaluation baseline (categorization, recurring payments, prices, and assistant tool choice in an earlier version). The extension does not call it. We also used Claude (Anthropic) as a coding assistant to help write and test code. The product decisions are ours and are recorded in `docs/spec.md`.

## Team

[names, schools]
