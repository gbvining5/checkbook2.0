// End-to-end tests: drive the real app in a browser like a person would.
// Run:  npm run test:e2e     (first time: npm install && npx playwright install chromium)
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = 'file://' + path.join(__dirname, '..', 'index.html');
const UNIT = 'file://' + path.join(__dirname, 'unit.html');

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await expect(page.locator('#sb-current')).toHaveText('$900,000.00'); // sample book
  return errors;
}

async function writeCheck(page, payee, amount, account) {
  await page.click('.tab[data-tab=check]');
  await page.fill('#p-payee', payee);
  await page.fill('#p-amount', amount);
  await page.selectOption('#p-splits tr:nth-child(1) .sp-acct', account);
  await page.click('#page-check .js-record');
}

test('unit tests pass in the browser too', async ({ page }) => {
  await page.goto(UNIT);
  const r = await page.evaluate(() => window.__testResults);
  expect(r.failed, JSON.stringify(r.results.filter(x => !x.ok))).toBe(0);
});

test('write a check, split a check, make a deposit', async ({ page }) => {
  const errors = await open(page);

  await writeCheck(page, 'Carwash', '1,250.5', 'Maint.');
  await expect(page.locator('#sb-current')).toHaveText('$898,749.50');
  await expect(page.locator('#p-number')).toHaveValue('3'); // next check number

  // split: 300 = 200 Fuel + 100 Maint.
  await page.fill('#p-payee', 'Shell');
  await page.fill('#p-amount', '300');
  await page.selectOption('#p-splits tr:nth-child(1) .sp-acct', 'Fuel');
  await page.click('#p-addsplit');
  await page.fill('#p-splits tr:nth-child(1) .sp-amt', '200');
  await page.selectOption('#p-splits tr:nth-child(2) .sp-acct', 'Maint.');
  await page.fill('#p-splits tr:nth-child(2) .sp-amt', '50');
  await page.click('#page-check .js-record');
  await expect(page.locator('#overlay')).toBeVisible();          // refuses: lines don't add up
  await page.click('#dlg-buttons button');
  await page.fill('#p-splits tr:nth-child(2) .sp-amt', '100');
  await page.click('#page-check .js-record');
  await expect(page.locator('#sb-current')).toHaveText('$898,449.50');

  await page.click('.tab[data-tab=deposit]');
  await page.fill('#d-payee', 'ABC Co.');
  await page.fill('#d-amount', '5000');
  await page.selectOption('#d-splits .sp-acct', 'Sales');
  await page.click('#page-deposit .js-record');
  await expect(page.locator('#sb-current')).toHaveText('$903,449.50');

  expect(errors).toEqual([]);
});

test('cannot record a check with no payee or a bad amount', async ({ page }) => {
  await open(page);
  await page.fill('#p-amount', 'abc');
  await page.click('#page-check .js-record');
  await expect(page.locator('#dlg-body')).toContainText('Enter who you paid');
  await expect(page.locator('#dlg-body')).toContainText('greater than zero');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#sb-current')).toHaveText('$900,000.00');
});

test('edit, reconcile, delete, and everything survives a reload', async ({ page }) => {
  await open(page);
  await page.click('#register tbody:nth-of-type(1) tr.r1 td:nth-child(3)'); // sample check #1 ($150)
  await expect(page.locator('#page-check .edit-banner')).toBeVisible();
  await page.fill('#p-amount', '200');
  await page.click('#page-check .js-record');
  await expect(page.locator('#sb-current')).toHaveText('$899,950.00');

  await page.click('#register tbody:nth-of-type(1) .rec-box');
  await expect(page.locator('#sb-cleared')).toHaveText('$899,800.00');

  await page.click('#register tbody:nth-of-type(2) tr.r1 td:nth-child(3)'); // the deposit
  await page.click('.toolbar [data-cmd=delete]');
  await page.click('#dlg-buttons .btn.default');
  await expect(page.locator('#sb-current')).toHaveText('$899,800.00');

  await page.reload();
  await expect(page.locator('#sb-current')).toHaveText('$899,800.00');
  await expect(page.locator('#sb-cleared')).toHaveText('$899,800.00');
  await expect(page.locator('#register tbody')).toHaveCount(1);
});

test('a version-1 backup file still opens', async ({ page }) => {
  await open(page);
  const v1 = {
    version: 1,
    settings: { company: 'Old Backup Co', bankAccount: '1234', beginningBalance: 50000 },
    expenseAccounts: ['Maint.'], incomeAccounts: ['Sales'], payees: [{ name: 'Carwash' }],
    transactions: [{ id: 'x1', kind: 'payment', type: 'Check', number: 7, date: '2025-05-01', payee: 'Carwash',
      amount: 2500, splits: [{ account: 'Maint.', amount: 2500, memo: '', payee: 'Carwash' }] }]
  };
  const file = path.join(os.tmpdir(), 'cb-v1-backup.json');
  fs.writeFileSync(file, JSON.stringify(v1));
  await page.setInputFiles('#file-open', file);
  await page.click('#dlg-buttons .btn.default'); // Replace
  await expect(page.locator('#sb-current')).toHaveText('$475.00');
  await expect(page.locator('#addr-text')).toContainText('Old Backup Co');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('checkbook.v1')));
  expect(saved.version).toBeGreaterThan(1);
});

test('a file that is not a checkbook is rejected safely', async ({ page }) => {
  await open(page);
  const file = path.join(os.tmpdir(), 'cb-junk.json');
  fs.writeFileSync(file, '{"hello":"world"}');
  await page.setInputFiles('#file-open', file);
  await expect(page.locator('#dlg-body')).toContainText('not a CheckBook backup');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#sb-current')).toHaveText('$900,000.00');
});

test('windows: minimize, restore, maximize, close, reopen', async ({ page }) => {
  await open(page);
  const win = page.locator('#win-checkbook');
  await page.click('#win-checkbook .cap-min');
  await expect(win).toHaveClass(/minimized/);
  await page.click('.task-btn');
  await expect(win).not.toHaveClass(/minimized/);
  await page.click('#win-checkbook .cap-max');
  await expect(win).toHaveClass(/maximized/);
  await page.click('#win-checkbook .cap-max');
  await expect(win).not.toHaveClass(/maximized/);
  await page.click('#win-checkbook .cap-close');
  await expect(win).toHaveClass(/closed/);
  await page.dblclick('.dicon[data-open=checkbook]');
  await expect(win).not.toHaveClass(/closed/);
});

/* ---------------- Reconcile ---------------- */
const savedBook = page => page.evaluate(() => JSON.parse(localStorage.getItem('checkbook.v1')));

async function openReconcile(page) {
  await page.click('.toolbar [data-cmd=reconcile]');
  await expect(page.locator('#win-reconcile')).not.toHaveClass(/closed/);
}
async function startStatement(page, date, ending) {
  await page.fill('#rc-date', date);
  await page.fill('#rc-ending', ending);
  await page.click('#rc-next');
  await expect(page.locator('#rc-step2')).toBeVisible();
}

test('reconcile: off by $15 until a $15 bank fee is added, then Finish locks the items as R', async ({ page }) => {
  const errors = await open(page);
  await openReconcile(page);
  await expect(page.locator('#rc-opening')).toHaveValue('$900,000.00');   // beginning balance, first time
  await expect(page.locator('#rc-opening')).toHaveAttribute('readonly', '');
  await startStatement(page, '2026-11-30', '899,985.00');

  await expect(page.locator('#rc-pay tbody tr[data-id]')).toHaveCount(1);
  await expect(page.locator('#rc-dep tbody tr[data-id]')).toHaveCount(1);
  await page.click('[data-mark=payment][data-on="1"]');
  await page.click('[data-mark=deposit][data-on="1"]');
  await expect(page.locator('#rc-t-stmt')).toHaveText('$899,985.00');
  await expect(page.locator('#rc-t-cleared')).toHaveText('$900,000.00');
  await expect(page.locator('#rc-t-diff')).toHaveText('-$15.00');
  await expect(page.locator('#rc-finish')).toBeDisabled();

  // the missing item goes through the same checks as Write Check: an Account is required
  await page.click('#rc-add');
  await page.fill('#rc-m-payee', 'First Bank');
  await page.fill('#rc-m-amount', '15');
  await page.selectOption('#rc-m-account', '');
  await page.click('#rc-m-add');
  await expect(page.locator('#dlg-body')).toContainText('Choose an account');
  await page.click('#dlg-buttons button');
  expect((await savedBook(page)).transactions).toHaveLength(2);           // nothing was added
  await page.selectOption('#rc-m-account', 'Bank Fees');
  await page.click('#rc-m-add');

  await expect(page.locator('#rc-pay tbody tr.ticked')).toHaveCount(2);  // arrived already ticked
  await expect(page.locator('#rc-t-diff')).toHaveText('$0.00');
  await expect(page.locator('#rc-finish')).toBeEnabled();
  await page.click('#rc-finish');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);

  await expect(page.locator('#register .rec-r')).toHaveCount(3);
  await expect(page.locator('#register .rec-r').first()).toHaveText('R');
  await expect(page.locator('#register .rec-box')).toHaveCount(0);       // R is not clickable
  await expect(page.locator('#sb-cleared')).toHaveText('$899,985.00');
  await expect(page.locator('#sb-current')).toHaveText('$899,985.00');

  const saved = await savedBook(page);
  expect(saved.version).toBe(3);
  expect(saved.reconciliations).toHaveLength(1);
  expect(saved.reconciliations[0]).toMatchObject({ statementDate: '2026-11-30', openingBalance: 90000000, endingBalance: 89998500 });
  expect(saved.reconciliations[0].transactionIds).toHaveLength(3);
  expect(saved.transactions.every(t => t.reconciledId === saved.reconciliations[0].id && t.cleared)).toBe(true);
  expect(saved.reconcileDraft).toBeNull();

  // next statement starts from this one's ending balance
  await openReconcile(page);
  await expect(page.locator('#rc-opening')).toHaveValue('$899,985.00');
  expect(errors).toEqual([]);
});

test('reconcile: Cancel changes nothing', async ({ page }) => {
  await open(page);
  const before = await savedBook(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '900000');
  await page.click('#rc-pay tbody tr[data-id] .rc-tick');
  await expect(page.locator('#rc-t-diff')).toHaveText('$150.00');
  await page.click('#rc-step2 .js-rc-cancel');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
  expect(await savedBook(page)).toEqual(before);
  await expect(page.locator('#register .rec-r')).toHaveCount(0);
  await openReconcile(page);                                             // starts fresh
  await expect(page.locator('#rc-step1')).toBeVisible();
  await expect(page.locator('#rc-date')).toHaveValue('');
});

test('reconcile: Leave Unfinished survives a reload; Cancel keeps the saved session; Start Over discards it', async ({ page }) => {
  await open(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '900000');
  await page.click('#rc-dep tbody tr[data-id] .rc-tick');
  await page.click('#rc-leave');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
  let saved = await savedBook(page);
  expect(saved.reconcileDraft).toMatchObject({ statementDate: '2026-11-30', endingBalance: 90000000 });
  expect(saved.reconcileDraft.tickedIds).toHaveLength(1);
  expect(saved.transactions.every(t => t.reconciledId === null && t.cleared === false)).toBe(true);   // no transaction changed

  await page.reload();
  await openReconcile(page);
  await expect(page.locator('#rc-step2')).toBeVisible();
  await expect(page.locator('#rc-dep tbody tr.ticked')).toHaveCount(1);
  await expect(page.locator('#rc-t-diff')).toHaveText('-$150.00');

  // tick something more, then Cancel: back to the saved session (not to nothing)
  await page.click('#rc-pay tbody tr[data-id] .rc-tick');
  await page.click('#rc-step2 .js-rc-cancel');
  expect((await savedBook(page)).reconcileDraft.tickedIds).toHaveLength(1);
  await openReconcile(page);
  await expect(page.locator('#rc-pay tbody tr.ticked')).toHaveCount(0);
  await expect(page.locator('#rc-dep tbody tr.ticked')).toHaveCount(1);

  // Start Over asks first, then throws the saved session away
  await page.click('#rc-back');
  await expect(page.locator('#rc-draft-note')).toBeVisible();
  await page.click('#rc-startover');
  await expect(page.locator('#dlg-body')).toContainText('Throw away');
  await page.click('#dlg-buttons .btn.default');
  expect((await savedBook(page)).reconcileDraft).toBeNull();
  await expect(page.locator('#rc-date')).toHaveValue('');
  await expect(page.locator('#rc-startover')).toBeHidden();
});

test('reconcile: closing with the X while items are ticked asks Leave Unfinished / Discard / Cancel', async ({ page }) => {
  await open(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '900000');
  await page.click('#rc-pay tbody tr[data-id] .rc-tick');

  await page.click('#win-reconcile .cap-close');
  await expect(page.locator('#dlg-buttons button')).toHaveText(['Leave Unfinished', 'Discard', 'Cancel']);
  await page.click('#dlg-buttons button:has-text("Cancel")');
  await expect(page.locator('#win-reconcile')).not.toHaveClass(/closed/);
  await expect(page.locator('#rc-pay tbody tr.ticked')).toHaveCount(1);

  await page.click('#win-reconcile .cap-close');
  await page.click('#dlg-buttons button:has-text("Discard")');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
  expect((await savedBook(page)).reconcileDraft).toBeNull();

  await openReconcile(page);
  await startStatement(page, '2026-11-30', '900000');
  await page.click('#rc-pay tbody tr[data-id] .rc-tick');
  await page.click('#win-reconcile .cap-close');
  await page.click('#dlg-buttons button:has-text("Leave Unfinished")');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
  expect((await savedBook(page)).reconcileDraft.tickedIds).toHaveLength(1);

  // nothing new since it was opened: the X just closes
  await openReconcile(page);
  await page.click('#win-reconcile .cap-close');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
});

test('a version-2 backup file still opens (cleared ticks kept as "c")', async ({ page }) => {
  await open(page);
  const v2 = {
    version: 2,
    settings: { company: 'V2 Backup Co', bankAccount: '', beginningBalance: 50000 },
    expenseAccounts: ['Maint.', 'Bank Fees'], incomeAccounts: ['Sales'], payees: [{ name: 'Carwash', address: '', city: '' }],
    transactions: [
      { id: 'x1', seq: 1, kind: 'payment', type: 'Check', number: '7', date: '2025-05-01', payee: 'Carwash', amount: 2500, memo: '',
        cleared: true, splits: [{ account: 'Maint.', amount: 2500, memo: '', payee: 'Carwash' }] },
      { id: 'x2', seq: 2, kind: 'deposit', type: 'Deposit', number: '', date: '2025-05-03', payee: 'ABC', amount: 10000, memo: '',
        cleared: false, splits: [{ account: 'Sales', amount: 10000, memo: '', payee: 'ABC' }] }
    ]
  };
  const file = path.join(os.tmpdir(), 'cb-v2-backup.json');
  fs.writeFileSync(file, JSON.stringify(v2));
  await page.setInputFiles('#file-open', file);
  await page.click('#dlg-buttons .btn.default'); // Replace
  await expect(page.locator('#sb-current')).toHaveText('$575.00');
  await expect(page.locator('#sb-cleared')).toHaveText('$475.00');
  await expect(page.locator('#register .rec-box')).toHaveText(['c', '']);

  const saved = await savedBook(page);
  expect(saved.version).toBe(3);
  expect(saved.reconciliations).toEqual([]);
  expect(saved.reconcileDraft).toBeNull();
  expect(saved.transactions.map(t => [t.cleared, t.reconciledId])).toEqual([[true, null], [false, null]]);

  // clicking Rec. toggles "c"
  await page.click('#register tbody:nth-of-type(2) .rec-box');
  await expect(page.locator('#register .rec-box')).toHaveText(['c', 'c']);
  await expect(page.locator('#sb-cleared')).toHaveText('$575.00');
  await page.click('#register tbody:nth-of-type(2) .rec-box');

  // first reconcile of this book: opening = beginning balance; the cleared check starts ticked
  await openReconcile(page);
  await expect(page.locator('#rc-opening')).toHaveValue('$500.00');
  await startStatement(page, '2025-05-31', '475');
  await expect(page.locator('#rc-pay tbody tr.ticked')).toHaveCount(1);
  await expect(page.locator('#rc-dep tbody tr.ticked')).toHaveCount(0);
  await expect(page.locator('#rc-t-diff')).toHaveText('$0.00');
});

// Bug fix: with two blank account lines, both were skipped and a check with NO account was recorded.
test('a check whose account lines are all blank is refused', async ({ page }) => {
  await open(page);
  await page.click('#p-addsplit');
  await page.fill('#p-payee', 'Shell');
  await page.fill('#p-amount', '40');
  await page.click('#page-check .js-record');
  await expect(page.locator('#dlg-body')).toContainText('Choose an account');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#sb-current')).toHaveText('$900,000.00');
  expect((await savedBook(page)).transactions).toHaveLength(2);
});
