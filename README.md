# CheckBook

A simple check register that runs in any web browser, styled like Windows 7 / old Internet Explorer.

## Features
- **Write Check / Payment** — check #, date, payee, amount (written out in words), memo, transaction type (Check, Debit Card, ACH, Bank Fee)
- **Make Deposit** — received from, amount, memo
- **Split transactions** — spread one check or deposit across several accounts
- **Register** — running balance, click any row to edit, **Rec.** column (**c** = cleared, **R** = reconciled), search box
- **Void a check** — keeps it in the register with its number, shows VOID and counts it as $0.00; Unvoid puts it back
- **Reconcile** — once a month, tick items against the bank statement until the difference is $0.00, then lock them
- **Accounts & Payees** — expense accounts, income accounts, payee addresses
- **Backup / Open** (.json), **Export to Excel** (.csv), **Print** register

## How to run
Open `index.html` in a browser. No install, no server, no internet needed.

Or use the GitHub Pages link once it's turned on.

## Where the data lives
Everything is saved in the browser's local storage on the computer you're using.
It does **not** sync between computers, and clearing browser data can erase it.
Use **File > Save Backup** regularly.

No transaction data is stored in this repository — only the program.

## Desktop
The app opens on a Windows 7-style desktop with a taskbar.
- Double-click a desktop icon to open a window.
- Drag title bars to move windows; drag edges/corners to resize.
- Minimize sends a window to the taskbar; Maximize fills the screen; Close closes it (data is kept).
- Window positions and sizes are remembered. Start menu > Reset Window Layout puts them back.

## Project layout
- `index.html` — the page (desktop, windows, taskbar)
- `js/core/` — logic with no screen code: money, data format, saving, balances
- `js/ui/` — message boxes and the window manager
- `js/checkbook/` — the CheckBook window, one file per part
- `css/` — styles · `icons/` — desktop icons · `tests/` — automated tests

**Changing the code? Read [`CLAUDE.md`](CLAUDE.md) first** — it has the rules, a full file map,
and how to add features safely. Log changes in [`CHANGELOG.md`](CHANGELOG.md).

## Tests
- Quick check, no install: open `tests/unit.html` in a browser — it should be all green.
- With Node.js installed:
  - `npm install` (first time only)
  - `npm test` — unit tests (money math, balances, data upgrades, safe loading)
  - `npx playwright install chromium` (first time only), then `npm run test:e2e` — clicks through the real app
- GitHub runs all tests automatically on every push (see the **Actions** tab).
