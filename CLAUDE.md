# CheckBook — Rules for anyone changing this code (AI or human)

Read this whole file before making changes. It is short on purpose.

## What this is
A simple, offline check register that runs in a web browser, styled like Windows 7.
Plain HTML/CSS/JavaScript. **No build step, no framework, no server.** Open `index.html` and it runs.

## The non-negotiable rules
1. **Money is whole cents (integers).** `$150.00` is stored as `15000`. Never store or add decimals.
   Convert text with `CB.money.toCents()`, display with `CB.money.format()`.
2. **No network requests. Ever.** No fetch/XHR/analytics/CDN scripts/fonts from the web.
   Users trust that their financial data never leaves their computer.
3. **Never silently lose user data.** Their data exists only in their browser and backup files.
   - Changing the saved data shape? Follow "Changing the data format" below.
   - Never delete/overwrite stored data without the user confirming.
4. **Always escape user text** before putting it in HTML: `CB.util.esc(text)`.
5. **Keep it simple.** The main CheckBook window stays a plain check register.
   Bigger features get their **own desktop window/icon** so beginners never have to see them.
6. **No `alert()` / `confirm()` / `prompt()`** — use `CB.dialog(title, html, buttons)`.
7. **Change only what the task needs.** Don't reformat, rename, or "clean up" unrelated code.

## File map (load order matters — see `index.html`)
| File | Job | Touches screen? |
|---|---|---|
| `js/core/util.js` | `$`, `esc`, dates, ids | no |
| `js/core/money.js` | cents parsing/formatting, amount in words | no |
| `js/core/schema.js` | data shape, `VERSION`, migrations, `validate()` | no |
| `js/core/store.js` | load/save to localStorage safely, open backups | no |
| `js/core/ledger.js` | balances, sorting, check numbers (pure functions) | no |
| `js/ui/dialog.js` | message boxes, status bar | yes |
| `js/ui/desktop.js` | desktop, windows (move/resize/min/max/close), taskbar | yes |
| `js/checkbook/state.js` | `CB.app` — the open book + `commit()` | — |
| `js/checkbook/register.js` | draws the register + balances | yes |
| `js/checkbook/splits.js` | account-lines table under each form | yes |
| `js/checkbook/forms.js` | Write Check / Make Deposit: validate, record, edit, delete | yes |
| `js/checkbook/lists.js` | Accounts & Payees tab, Settings tab | yes |
| `js/checkbook/files.js` | Save/Open backup, CSV export, New checkbook | yes |
| `js/checkbook/main.js` | menus, toolbar, tabs; starts the app (**load last**) | yes |
| `css/checkbook.css` | CheckBook window look | |
| `css/desktop.css` | desktop, taskbar, window chrome | |

Everything hangs off one global: `window.CB`. Files are classic `<script>`s (not ES modules)
so the app works when opened straight from a file (`file://`).

## How to change data (always this pattern)
```js
var book = CB.app.book;
// ...modify book...
CB.app.commit('Status bar message');   // saves + redraws everything
```
Calculations belong in `js/core/ledger.js` as pure functions (take a book, return a value),
so they can be unit tested.

## Changing the data format
1. In `js/core/schema.js`: bump `VERSION` by 1.
2. Add `MIGRATIONS[oldVersion] = function (d) { ...; d.version = oldVersion + 1; return d; }`.
3. Update the shape comment at the top of `schema.js` and `validate()` if needed.
4. Add a unit test proving an old-version book still loads and validates.
5. Never delete or edit an existing migration.

## Adding a new feature window (e.g. Reports)
1. `index.html`: copy the `win-help` block → new `id`, `data-app`, `data-title`, `data-icon`.
2. Add a desktop icon (`<button class="dicon" data-open="name">`) and a Start-menu entry.
3. Put its code in its own file, e.g. `js/reports/reports.js`, and its styles in its own CSS file.
4. Read data from `CB.app.book`; put calculations in `ledger.js` (or a new core file) with tests.

## Tests — run them after EVERY change
- `npm test` — unit tests for money, balances, migrations, safe loading (Node, ~1 second).
  No Node? Open `tests/unit.html` in a browser — it should say "All tests passed".
- `npm run test:e2e` — clicks through the real app in a browser.
  First time: `npm install` then `npx playwright install chromium`.
- GitHub runs both automatically on every push (`.github/workflows/test.yml`).
- **Fixing a bug? Add a test that would have caught it** (`tests/unit.tests.js` or `tests/e2e.spec.js`).

## Checklist before saying a change is done
- [ ] `npm test` passes and `npm run test:e2e` passes
- [ ] No new network requests; money still in cents
- [ ] Old backups still open (if the data format changed)
- [ ] Only files related to the task were changed
- [ ] `CHANGELOG.md` has a line describing the change

## Decisions already made (don't re-litigate without asking the owner)
- Local-only storage; no accounts/logins/cloud. Optional future: user saves an encrypted
  backup into *their own* cloud folder.
- Windows 7 / old Internet Explorer look.
- Storage key is `checkbook.v1` (kept for compatibility; the data's own `version` field is what matters).
