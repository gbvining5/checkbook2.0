# Changelog

Newest first. One or two lines per change — what changed and why.

## 2026-11-11 — Reconcile, part 1
- New Reconcile window (toolbar, Edit menu, desktop icon) to tick items against the bank statement until the difference is exactly $0.00, then lock them as reconciled ("R"); data format v3 adds `reconciliations`, `reconcileDraft` and `t.reconciledId`. Fixed: a check whose account lines were all blank was recorded with no account.

## 2026-11-11 — Safety foundations
- Split the single `app.js` into small files by job (`js/core`, `js/ui`, `js/checkbook`). No behavior change.
- Added data format versioning (now version 2) with automatic upgrades; old data is kept before upgrading.
- Loading never silently discards data anymore: unreadable data is kept in a rescue copy, and data
  from a newer app version turns saving off instead of being overwritten.
- Backups are checked before opening (bad amounts, splits that don't add up, etc.).
- Fixed amount rounding: "1.005" now becomes $1.01 (was $1.00 due to floating-point math).
- CSV export no longer lets text starting with `=`, `+`, `@` run as an Excel formula.
- Added automated tests (unit + end-to-end) and a GitHub workflow that runs them on every push.
- Added `CLAUDE.md` (rules for changing the code) and this changelog.

## 2026-11-09 — Desktop
- Windows 7 desktop with icons, taskbar, Start menu; windows move, resize, minimize, maximize, close.

## 2026-11-09 — First version
- Check register, Write Check, Make Deposit, split accounts, payees, settings, backup/CSV/print.
