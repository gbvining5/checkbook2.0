# Changelog

Newest first. One or two lines per change — what changed and why.

## 2026.11.13 — Void checks
- Void a check (Edit menu, or Void Check on the form): it stays in the register with its number, shows VOID and counts as $0.00 everywhere. Unvoid puts it back exactly as it was.
- Reconciled (R) checks can't be voided; cleared (c) checks warn first; deleting a voided check warns that its number is freed. Reconcile hints at a voided check the bank paid; CSV adds a "Void" column.
- Data format version 4 (adds `voidedAt`); older data and backups upgrade automatically.

## 2026.11.12-4 — Bug fixes from review
- Two CheckBook windows open at once no longer overwrite each other: when one saves, the other stops saving and offers Reload.
- Saved data that can't be read is never overwritten when its rescue copy can't be made (storage full), and starting again no longer piles up identical rescue copies.
- Editing a check's payee or memo now updates its account lines; backups with a nameless payee are refused as damaged; an account can be renamed by changing only its capitals.
- Message boxes now wait their turn instead of closing each other; check #0101 and #101 count as the same check; impossible dates are refused.
- The sample checkbook uses made-up names (ABC Co., Maple St.), and repeated code was merged (new transactions, whole-cents check, "Please Fix" box). No data format change.

## 2026.11.12-3 — Repository housekeeping
- Added .gitignore (keeps node_modules, test output, zips and your CheckBook_ backups/CSV exports out of git) and the GitHub workflow (.github/workflows/test.yml) that CLAUDE.md already described; no app changes.

## 2026.11.12-2 — Safer handling of saved data this copy can't open
- Before saved data from a newer version (or damaged data) is replaced, it is downloaded as a file and kept as a rescue copy; if the rescue copy can't be written (storage full), nothing is replaced unless you confirm you have the file.
- Damaged saved data is no longer loaded at startup (it blanked the register on every start): saving is turned off, a rescue copy is kept, and you're told to open a backup. Backups are checked for the same, wider set of damage.
- New File > Recover Rescue Copies lists rescue copies and downloads them for Open Backup; reloading or closing with unsaved Reconcile ticks now asks first.

## 2026.11.12 — Bug fixes from testing
- The app now shows its version (taskbar, next to the clock, and Help > About); version = release date, kept in js/core/version.js.
- Opening a backup or starting a new checkbook while saving is blocked (data from a newer version) now keeps a rescue copy instead of overwriting it.
- Backups with unreadable transaction entries are refused (they used to be saved and blank the register on every start).
- CSV export: text like `-2+3+cmd|...` is now prefixed so Excel can't run it as a formula; only plain numbers may start with `-`.

## 2026.11.11-3 — Reconcile, part 2
- Reconcile now gives hints when it doesn't balance, warns before changing/deleting a reconciled item or the beginning balance, confirms Finish, can undo the most recent reconciliation, shows a printable report (after Finish and for past statements), reminds you on Cancel that added items stay, and CSV Rec. shows R/X/blank; no data format change.

## 2026.11.11-2 — Reconcile, part 1
- New Reconcile window (toolbar, Edit menu, desktop icon) to tick items against the bank statement until the difference is exactly $0.00, then lock them as reconciled ("R"); data format v3 adds `reconciliations`, `reconcileDraft` and `t.reconciledId`. Fixed: a check whose account lines were all blank was recorded with no account.

## 2026.11.11 — Safety foundations
- Split the single `app.js` into small files by job (`js/core`, `js/ui`, `js/checkbook`). No behavior change.
- Added data format versioning (now version 2) with automatic upgrades; old data is kept before upgrading.
- Loading never silently discards data anymore: unreadable data is kept in a rescue copy, and data
  from a newer app version turns saving off instead of being overwritten.
- Backups are checked before opening (bad amounts, splits that don't add up, etc.).
- Fixed amount rounding: "1.005" now becomes $1.01 (was $1.00 due to floating-point math).
- CSV export no longer lets text starting with `=`, `+`, `@` run as an Excel formula.
- Added automated tests (unit + end-to-end) and a GitHub workflow that runs them on every push.
- Added `CLAUDE.md` (rules for changing the code) and this changelog.

## 2026.11.09-2 — Desktop
- Windows 7 desktop with icons, taskbar, Start menu; windows move, resize, minimize, maximize, close.

## 2026.11.09 — First version
- Check register, Write Check, Make Deposit, split accounts, payees, settings, backup/CSV/print.
