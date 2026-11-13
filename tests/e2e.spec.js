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
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00'); // sample book
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
  await expect(page.locator('#sb-current')).toHaveText('$8,749.50');
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
  await expect(page.locator('#sb-current')).toHaveText('$8,449.50');

  await page.click('.tab[data-tab=deposit]');
  await page.fill('#d-payee', 'ABC Co.');
  await page.fill('#d-amount', '5000');
  await page.selectOption('#d-splits .sp-acct', 'Sales');
  await page.click('#page-deposit .js-record');
  await expect(page.locator('#sb-current')).toHaveText('$13,449.50');

  expect(errors).toEqual([]);
});

test('cannot record a check with no payee or a bad amount', async ({ page }) => {
  await open(page);
  await page.fill('#p-amount', 'abc');
  await page.click('#page-check .js-record');
  await expect(page.locator('#dlg-body')).toContainText('Enter who you paid');
  await expect(page.locator('#dlg-body')).toContainText('greater than zero');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');
});

test('edit, reconcile, delete, and everything survives a reload', async ({ page }) => {
  await open(page);
  await page.click('#register tbody:nth-of-type(1) tr.r1 td:nth-child(3)'); // sample check #1 ($150)
  await expect(page.locator('#page-check .edit-banner')).toBeVisible();
  await page.fill('#p-amount', '200');
  await page.click('#page-check .js-record');
  await expect(page.locator('#sb-current')).toHaveText('$9,950.00');

  await page.click('#register tbody:nth-of-type(1) .rec-box');
  await expect(page.locator('#sb-cleared')).toHaveText('$9,800.00');

  await page.click('#register tbody:nth-of-type(2) tr.r1 td:nth-child(3)'); // the deposit
  await page.click('.toolbar [data-cmd=delete]');
  await page.click('#dlg-buttons .btn.default');
  await expect(page.locator('#sb-current')).toHaveText('$9,800.00');

  await page.reload();
  await expect(page.locator('#sb-current')).toHaveText('$9,800.00');
  await expect(page.locator('#sb-cleared')).toHaveText('$9,800.00');
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
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');
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
// Part 2: Finish asks first, then shows the report
async function confirmFinish(page, text) {
  await expect(page.locator('#dlg-body')).toHaveText(text);
  await page.click('#dlg-buttons button:has-text("Reconcile")');
  await expect(page.locator('#rc-step3')).toBeVisible();
}

test('reconcile: off by $15 until a $15 bank fee is added, then Finish locks the items as R', async ({ page }) => {
  const errors = await open(page);
  await openReconcile(page);
  await expect(page.locator('#rc-opening')).toHaveValue('$10,000.00');   // beginning balance, first time
  await expect(page.locator('#rc-opening')).toHaveAttribute('readonly', '');
  await startStatement(page, '2026-11-30', '9,985.00');

  await expect(page.locator('#rc-pay tbody tr[data-id]')).toHaveCount(1);
  await expect(page.locator('#rc-dep tbody tr[data-id]')).toHaveCount(1);
  await page.click('[data-mark=payment][data-on="1"]');
  await page.click('[data-mark=deposit][data-on="1"]');
  await expect(page.locator('#rc-t-stmt')).toHaveText('$9,985.00');
  await expect(page.locator('#rc-t-cleared')).toHaveText('$10,000.00');
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
  await confirmFinish(page, 'Reconcile 3 items for statement dated 11/30/2026? You can undo this later.');
  await page.click('#rc-report-done');                                   // Part 2: Finish now shows the report first
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);

  await expect(page.locator('#register .rec-r')).toHaveCount(3);
  await expect(page.locator('#register .rec-r').first()).toHaveText('R');
  await expect(page.locator('#register .rec-box')).toHaveCount(0);       // R is not clickable
  await expect(page.locator('#sb-cleared')).toHaveText('$9,985.00');
  await expect(page.locator('#sb-current')).toHaveText('$9,985.00');

  const saved = await savedBook(page);
  expect(saved.version).toBe(4);
  expect(saved.reconciliations).toHaveLength(1);
  expect(saved.reconciliations[0]).toMatchObject({ statementDate: '2026-11-30', openingBalance: 1000000, endingBalance: 998500 });
  expect(saved.reconciliations[0].transactionIds).toHaveLength(3);
  expect(saved.transactions.every(t => t.reconciledId === saved.reconciliations[0].id && t.cleared)).toBe(true);
  expect(saved.reconcileDraft).toBeNull();

  // next statement starts from this one's ending balance
  await openReconcile(page);
  await expect(page.locator('#rc-opening')).toHaveValue('$9,985.00');
  expect(errors).toEqual([]);
});

test('reconcile: Cancel changes nothing', async ({ page }) => {
  await open(page);
  const before = await savedBook(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');
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
  await startStatement(page, '2026-11-30', '10000');
  await page.click('#rc-dep tbody tr[data-id] .rc-tick');
  await page.click('#rc-leave');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);
  let saved = await savedBook(page);
  expect(saved.reconcileDraft).toMatchObject({ statementDate: '2026-11-30', endingBalance: 1000000 });
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
  await startStatement(page, '2026-11-30', '10000');
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
  await startStatement(page, '2026-11-30', '10000');
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
  expect(saved.version).toBe(4);
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
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');
  expect((await savedBook(page)).transactions).toHaveLength(2);
});

/* ---------------- Reconcile, part 2 ---------------- */
async function checkOn(page, payee, amount, account, date) {
  await page.click('.tab[data-tab=check]');
  await page.fill('#p-payee', payee);
  await page.fill('#p-amount', amount);
  await page.fill('#p-date', date);
  await page.selectOption('#p-splits tr:nth-child(1) .sp-acct', account);
  await page.click('#page-check .js-record');
  await expect(page.locator('#overlay')).toBeHidden();
}
// Reconcile the sample book's two items (Maple St. Car Wash check $150, XYZ Corp. deposit $150) through 11/30/2026
async function reconcileSample(page) {
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');
  await page.click('[data-mark=payment][data-on="1"]');
  await page.click('[data-mark=deposit][data-on="1"]');
  await page.click('#rc-finish');
  await confirmFinish(page, 'Reconcile 2 items for statement dated 11/30/2026? You can undo this later.');
  await page.click('#rc-report-done');
  await expect(page.locator('#register .rec-r')).toHaveCount(2);
}
const dlgButton = (page, label) => page.locator('#dlg-buttons button', { hasText: label });

test('reconcile: hints show only when true; Finish confirms; the report shows the right totals', async ({ page }) => {
  const errors = await open(page);
  await checkOn(page, 'Shell', '40', 'Fuel', '2026-11-10');          // will stay outstanding
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');
  await expect(page.locator('#rc-hints')).toBeHidden();               // nothing ticked yet: the two $150 items cancel out, so it balances
  await page.click('[data-mark=payment][data-on="1"]');
  await page.click('#rc-pay tbody tr:has-text("Shell") .rc-tick');    // untick Shell
  // only the $150 check is ticked: off by +$150.00, which is exactly the unticked XYZ Corp. deposit
  await expect(page.locator('#rc-t-diff')).toHaveText('$150.00');
  await expect(page.locator('#rc-hints')).toBeVisible();
  await expect(page.locator('#rc-hints li')).toHaveText(['Did XYZ Corp., $150.00 (11/07/2026) clear?']);
  await page.click('[data-mark=deposit][data-on="1"]');
  await expect(page.locator('#rc-t-diff')).toHaveText('$0.00');
  await expect(page.locator('#rc-hints')).toBeHidden();

  // Finish asks first; Cancel changes nothing
  await page.click('#rc-finish');
  await expect(page.locator('#dlg-body')).toHaveText('Reconcile 2 items for statement dated 11/30/2026? You can undo this later.');
  await dlgButton(page, 'Cancel').click();
  expect((await savedBook(page)).reconciliations).toEqual([]);
  await expect(page.locator('#rc-step2')).toBeVisible();

  await page.click('#rc-finish');
  await confirmFinish(page, 'Reconcile 2 items for statement dated 11/30/2026? You can undo this later.');
  const sum = page.locator('#rc-rep-sum');
  await expect(sum.locator('tr', { hasText: 'Statement date' }).locator('td')).toHaveText('11/30/2026');
  await expect(sum.locator('tr.rc-rep-open td')).toHaveText('$10,000.00');
  await expect(sum.locator('tr.rc-rep-pay th')).toHaveText('Cleared payments (1)');
  await expect(sum.locator('tr.rc-rep-pay td')).toHaveText('-$150.00');
  await expect(sum.locator('tr.rc-rep-dep th')).toHaveText('Cleared deposits (1)');
  await expect(sum.locator('tr.rc-rep-dep td')).toHaveText('$150.00');
  await expect(sum.locator('tr.rc-rep-end td')).toHaveText('$10,000.00');
  await expect(page.locator('#rc-rep-out tbody tr')).toHaveCount(1);
  await expect(page.locator('#rc-rep-out tbody tr')).toContainText('Shell');
  await expect(page.locator('#rc-rep-out tfoot')).toContainText('$40.00');
  await expect(page.locator('.rc-rep-warn')).toHaveCount(0);
  await page.click('#rc-report-done');
  await expect(page.locator('#win-reconcile')).toHaveClass(/closed/);

  // a past reconciliation's report opens from Step 1
  await openReconcile(page);
  await expect(page.locator('#rc-step1')).toBeVisible();
  await expect(page.locator('#rc-past-sel option')).toHaveCount(1);
  await page.click('#rc-past-view');
  await expect(page.locator('#rc-step3')).toBeVisible();
  await expect(page.locator('#rc-rep-sum tr.rc-rep-pay td')).toHaveText('-$150.00');
  await page.click('#rc-report-done');
  await expect(page.locator('#rc-step1')).toBeVisible();              // from Step 1, Done goes back to Step 1
  expect(errors).toEqual([]);
});

test('reconciled item: editing the amount warns (Cancel keeps it); editing the memo does not; delete warns', async ({ page }) => {
  const errors = await open(page);
  await reconcileSample(page);
  const carwash = '#register tbody:nth-of-type(1) tr.r1 td:nth-child(3)';

  await page.click(carwash);
  await page.fill('#p-amount', '200');
  await page.click('#page-check .js-record');
  await expect(page.locator('#dlg-body')).toContainText('This was reconciled on');
  await expect(page.locator('#dlg-body')).toContainText('(statement dated 11/30/2026). Changing it will make that reconciliation wrong.');
  await dlgButton(page, 'Cancel').click();
  let t = (await savedBook(page)).transactions[0];
  expect([t.amount, t.reconciledId != null]).toEqual([15000, true]);
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');

  await page.click(carwash);                                          // reloads the saved values
  await page.fill('#p-memo', 'Wash only');
  await page.click('#page-check .js-record');
  await expect(page.locator('#overlay')).toBeHidden();                // no warning for memo
  t = (await savedBook(page)).transactions[0];
  expect([t.memo, t.amount, t.reconciledId != null]).toEqual(['Wash only', 15000, true]);

  await page.click(carwash);
  await page.fill('#p-date', '2026-11-08');
  await page.click('#page-check .js-record');
  await expect(page.locator('#dlg-body')).toContainText('This was reconciled on');   // date warns too
  await dlgButton(page, 'Save Anyway').click();
  expect((await savedBook(page)).transactions[0].date).toBe('2026-11-08');

  await page.click(carwash);
  await page.click('.toolbar [data-cmd=delete]');
  await expect(page.locator('#dlg-body')).toContainText('Changing it will make that reconciliation wrong.');
  await dlgButton(page, 'Cancel').click();
  expect((await savedBook(page)).transactions).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('undo last reconciliation: R items go back to c, only the most recent one, with a confirm', async ({ page }) => {
  const errors = await open(page);
  await reconcileSample(page);
  // second statement: one more check
  await checkOn(page, 'Shell', '40', 'Fuel', '2026-12-05');
  await openReconcile(page);
  await startStatement(page, '2026-12-31', '9960');
  await page.click('[data-mark=payment][data-on="1"]');
  await page.click('#rc-finish');
  await confirmFinish(page, 'Reconcile 1 item for statement dated 12/31/2026? You can undo this later.');
  await page.click('#rc-report-done');
  await expect(page.locator('#register .rec-r')).toHaveCount(3);

  await openReconcile(page);
  await expect(page.locator('#rc-past-sel option')).toHaveCount(2);
  await page.click('#rc-undo');
  await expect(page.locator('#dlg-body')).toContainText('statement dated 12/31/2026');
  await dlgButton(page, 'Cancel').click();
  expect((await savedBook(page)).reconciliations).toHaveLength(2);    // Cancel: nothing undone

  await page.click('#rc-undo');
  await dlgButton(page, 'Undo').click();
  let saved = await savedBook(page);
  expect(saved.reconciliations.map(r => r.statementDate)).toEqual(['2026-11-30']);   // only the most recent one went
  await expect(page.locator('#register .rec-r')).toHaveCount(2);
  await expect(page.locator('#register tbody:has-text("Shell") .rec-box')).toHaveText('c');
  await expect(page.locator('#rc-opening')).toHaveValue('$10,000.00');

  // and again: the first one is now the most recent
  await page.click('#rc-undo');
  await expect(page.locator('#dlg-body')).toContainText('statement dated 11/30/2026');
  await dlgButton(page, 'Undo').click();
  saved = await savedBook(page);
  expect(saved.reconciliations).toEqual([]);
  expect(saved.transactions.every(t => t.reconciledId === null && t.cleared)).toBe(true);
  await expect(page.locator('#register .rec-r')).toHaveCount(0);
  await expect(page.locator('#register .rec-box')).toHaveText(['c', 'c', 'c']);
  await expect(page.locator('#rc-past')).toBeHidden();
  expect(errors).toEqual([]);
});

test('undo is refused while a reconciliation is in progress', async ({ page }) => {
  await open(page);
  await reconcileSample(page);
  await openReconcile(page);
  await startStatement(page, '2026-12-31', '10000');
  await page.click('#rc-back');                                       // ticks are in memory
  await page.click('#rc-undo');
  await expect(page.locator('#dlg-body')).toContainText('Finish or Cancel the reconciliation you are working on first.');
  await page.click('#dlg-buttons button');
  expect((await savedBook(page)).reconciliations).toHaveLength(1);
});

test('Cancel after adding a missing item says it stays in the register', async ({ page }) => {
  await open(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '9985');
  await page.click('#rc-add');
  await page.fill('#rc-m-payee', 'First Bank');
  await page.fill('#rc-m-amount', '15');
  await page.click('#rc-m-add');
  await page.click('#rc-step2 .js-rc-cancel');
  await expect(page.locator('#dlg-body')).toHaveText('1 item you added stays in the register. Delete it there if it was a mistake.');
  await page.click('#dlg-buttons button');
  expect((await savedBook(page)).transactions).toHaveLength(3);

  // Cancel with nothing added: no message
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '9985');
  await page.click('#rc-step2 .js-rc-cancel');
  await expect(page.locator('#overlay')).toBeHidden();
});

test('changing the beginning balance after a reconciliation warns; CSV Rec. column shows R / X / blank', async ({ page }) => {
  await open(page);
  // no reconciliation yet: no warning
  await page.click('.tab[data-tab=settings]');
  await page.fill('#s-begin', '10001');
  await page.click('#s-apply');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.fill('#s-begin', '10000');
  await page.click('#s-apply');

  await reconcileSample(page);
  await page.click('.tab[data-tab=settings]');
  await page.fill('#s-company', 'Renamed Co');
  await page.click('#s-apply');                                       // balance unchanged: no warning
  await expect(page.locator('#overlay')).toBeHidden();
  await page.fill('#s-begin', '1000');
  await page.click('#s-apply');
  await expect(page.locator('#dlg-body')).toContainText('statement dated 11/30/2026');
  await expect(page.locator('#dlg-body')).toContainText('Changing the beginning balance will make that reconciliation wrong.');
  await dlgButton(page, 'Cancel').click();
  expect((await savedBook(page)).settings.beginningBalance).toBe(1000000);
  await expect(page.locator('#s-begin')).toHaveValue('10000.00');
  await page.fill('#s-begin', '1000');
  await page.click('#s-apply');
  await dlgButton(page, 'Save Anyway').click();
  expect((await savedBook(page)).settings.beginningBalance).toBe(100000);

  // CSV: R = reconciled, X = cleared, blank otherwise
  await checkOn(page, 'Shell', '40', 'Fuel', '2026-12-05');
  await checkOn(page, 'Gas Co', '20', 'Utilities', '2026-12-06');
  await page.click('#register tbody:has-text("Shell") .rec-box');
  const rec = await page.evaluate(() => CB.files.buildCsv(CB.app.book).split('\r\n').slice(2)
    .map(l => l.split(','))
    .filter(c => c[0])                                                // first line of each transaction
    .map(c => [c[4], c[7]]));
  expect(rec).toEqual([['Maple St. Car Wash', 'R'], ['XYZ Corp.', 'R'], ['Shell', 'X'], ['Gas Co', '']]);
});

test('CSV: memo text like "-2+3+cmd|..." cannot run as an Excel formula; plain negative amounts stay numbers', async ({ page }) => {
  const errors = await open(page);
  await page.click('.tab[data-tab=check]');
  await page.fill('#p-payee', '-1+1');
  await page.fill('#p-amount', '5');
  await page.fill('#p-memo', "-2+3+cmd|' /C calc'!A0");
  await page.selectOption('#p-splits tr:nth-child(1) .sp-acct', 'Maint.');
  await page.click('#page-check .js-record');
  const line = await page.evaluate(() => CB.files.buildCsv(CB.app.book).split('\r\n').find(l => l.includes('cmd')));
  const cells = line.split(',');
  expect(cells[4]).toBe("'-1+1");                      // payee
  expect(cells[5]).toBe('-5.00');                      // amount: still a number
  expect(cells[6]).toBe("'-2+3+cmd|' /C calc'!A0");    // memo
  expect(errors).toEqual([]);
});

test('a damaged backup is refused and nothing is changed', async ({ page }) => {
  const errors = await open(page);
  const bad = path.join(os.tmpdir(), 'cb-damaged-' + Date.now() + '.json');
  fs.writeFileSync(bad, JSON.stringify({ version: 3, settings: { company: 'X', bankAccount: '', beginningBalance: 0 },
    expenseAccounts: [], incomeAccounts: [], payees: [], transactions: [null], reconciliations: [], reconcileDraft: null }));
  await page.setInputFiles('#file-open', bad);
  await expect(page.locator('#dlg-body')).toContainText('damaged');
  await page.click('#dlg-buttons button');
  await page.reload();
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');
  expect(errors).toEqual([]);
});

/* ---------------- app version ---------------- */
test('version shows in the taskbar and in About, and matches package.json and CHANGELOG', async ({ page }) => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const changelogTop = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n').find(l => l.startsWith('## '));
  await open(page);
  const appVersion = await page.evaluate(() => CB.APP_VERSION);
  expect(appVersion).toBe(pkg);                                        // js/core/version.js == package.json
  expect(changelogTop.startsWith('## ' + appVersion + ' ')).toBe(true); // newest CHANGELOG heading
  await expect(page.locator('#app-version')).toHaveText('Version ' + appVersion);
  await page.evaluate(() => CB.main.about());
  await expect(page.locator('#about-version')).toHaveText(appVersion);
});

/* ---------------- protecting saved data this copy can't open (2026.11.12-2) ---------------- */
const NEWER = JSON.stringify({ version: 99, settings: { company: 'From a newer copy' }, transactions: [] });
const stored = page => page.evaluate(() => localStorage.getItem('checkbook.v1'));
const rescues = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('checkbook.rescue.')).map(k => localStorage.getItem(k)));
async function loadWithStored(page, raw) {
  await page.evaluate(r => localStorage.setItem('checkbook.v1', r), raw);
  await page.reload();
  await expect(page.locator('#dlg-body')).toBeVisible();              // the startup warning
}
async function startNew(page) {
  await page.evaluate(() => CB.main.runCommand('new'));
  await dlgButton(page, 'Start New').click();
  await expect(page.locator('#dlg-title')).toHaveText('Keep the Saved Checkbook');
}
async function downloadAndContinue(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), dlgButton(page, 'Download and Continue').click()]);
  expect(dl.suggestedFilename()).toMatch(/^CheckBook_saved-data_\d{4}-\d\d-\d\d\.json$/);
  return fs.readFileSync(await dl.path(), 'utf8');
}

test('newer saved data: New Checkbook downloads it and keeps a rescue copy before replacing it', async ({ page }) => {
  const errors = await open(page);
  await loadWithStored(page, NEWER);
  await expect(page.locator('#dlg-body')).toContainText('newer version');
  await page.click('#dlg-buttons button');

  await startNew(page);
  expect(await downloadAndContinue(page)).toBe(NEWER);                  // the file IS the newer data
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await rescues(page)).toEqual([NEWER]);                         // and a rescue copy was kept
  expect(JSON.parse(await stored(page)).transactions).toEqual([]);      // only then was it replaced
  expect(errors).toEqual([]);
});

test('storage full: the newer data is not replaced unless you confirm you have the downloaded file', async ({ page }) => {
  await page.addInitScript(() => {                                      // rescue copies fail, like a full storage
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('checkbook.rescue.')) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  await open(page);
  await loadWithStored(page, NEWER);
  await page.click('#dlg-buttons button');

  await startNew(page);
  await downloadAndContinue(page);
  await expect(page.locator('#dlg-title')).toHaveText('No Rescue Copy');
  await dlgButton(page, 'Cancel').click();
  expect(await stored(page)).toBe(NEWER);                               // nothing replaced

  await startNew(page);
  await downloadAndContinue(page);
  await dlgButton(page, 'I Have the File, Continue').click();
  await expect(page.locator('#overlay')).toBeHidden();
  expect(JSON.parse(await stored(page)).version).toBe(4);               // replaced only after confirming
});

test('damaged saved data: the app still draws, nothing is overwritten, and a rescue copy is kept', async ({ page }) => {
  const errors = await open(page);
  const bad = await page.evaluate(() => { const b = CB.schema.sampleBook(); b.transactions.push(null); return JSON.stringify(b); });
  await loadWithStored(page, bad);
  await expect(page.locator('#dlg-body')).toContainText('Your saved checkbook is damaged (transaction 3 cannot be read)');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#sb-current')).toHaveText('$0.00');        // blank stand-in drew fine
  await page.reload();                                                  // and again on the next start
  await expect(page.locator('#dlg-body')).toContainText('damaged');
  expect(await stored(page)).toBe(bad);
  expect((await rescues(page)).every(r => r === bad)).toBe(true);
  expect(errors).toEqual([]);
});

test('File > Recover Rescue Copies lists the copies and downloads one', async ({ page }) => {
  await open(page);
  await page.evaluate(() => CB.main.runCommand('rescues'));
  await expect(page.locator('#dlg-body')).toHaveText('There are no rescue copies in this browser.');
  await page.click('#dlg-buttons button');

  await page.evaluate(() => {
    localStorage.setItem('checkbook.rescue.' + Date.UTC(2026, 0, 2, 15, 0, 0), '{"older":true}');
    localStorage.setItem('checkbook.rescue.' + Date.UTC(2026, 10, 12, 15, 0, 0), '{"newer":true}');
  });
  await page.click('.menu-title:has-text("File")');
  await page.click('.menu-items [data-cmd=rescues]');
  await expect(page.locator('#rescue-list tr')).toHaveCount(2);
  await expect(page.locator('#rescue-list tr').first()).toContainText('2026');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#rescue-list tr').first().locator('button').click()]);
  expect(dl.suggestedFilename()).toMatch(/^CheckBook_rescue_2026-11-1[12]_\d{6}\.json$/);   // newest first
  expect(fs.readFileSync(await dl.path(), 'utf8')).toBe('{"newer":true}');
  await expect(page.locator('#rescue-list')).toBeVisible();             // the list stays open
});

test('closing or reloading with unsaved reconcile ticks asks first', async ({ page, context }) => {
  await open(page);
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');
  await page.click('[data-mark=payment][data-on="1"]');               // unsaved ticks
  let asked = null;
  page.once('dialog', d => { asked = d.type(); d.dismiss(); });        // "Stay on page"
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toBe('beforeunload');
  expect(page.isClosed()).toBe(false);

  // no ticks in progress: no question
  const p2 = await context.newPage();
  await open(p2);
  let asked2 = null;
  p2.on('dialog', d => { asked2 = d.type(); d.dismiss(); });
  await p2.close({ runBeforeUnload: true });
  await expect.poll(() => p2.isClosed()).toBe(true);
  expect(asked2).toBe(null);
});

/* ---------------- fixes in 2026.11.12-4 ---------------- */
async function depositOn(page, payee, amount, account) {
  await page.click('.tab[data-tab=deposit]');
  await page.fill('#d-payee', payee);
  await page.fill('#d-amount', amount);
  await page.selectOption('#d-splits tr:nth-child(1) .sp-acct', account);
  await page.click('#page-deposit .js-record');
}

test('two windows: when one saves, the other stops saving (so it cannot wipe that out) and offers Reload', async ({ context }) => {
  const a = await context.newPage();
  const errors = await open(a);
  const b = await context.newPage();
  await open(b);

  await depositOn(b, 'From window B', '5', 'Sales');                   // B saves...
  await expect(a.locator('#dlg-title')).toHaveText('Open in Another Window');   // ...A is told
  await dlgButton(a, 'Not Now').click();

  await writeCheck(a, 'From window A', '1', 'Fuel');                    // A's out-of-date book is NOT saved
  await expect(a.locator('#dlg-title')).toHaveText('Open in Another Window');   // and A is reminded
  const payees = (await savedBook(b)).transactions.map(t => t.payee);
  expect(payees).toContain('From window B');
  expect(payees).not.toContain('From window A');

  await dlgButton(a, 'Reload').click();                                 // Reload shows B's work in A
  await expect(a.locator('#sb-current')).toHaveText('$10,005.00');
  await expect(a.locator('#overlay')).toBeHidden();
  await depositOn(b, 'Again from B', '1', 'Sales');                     // B still saves normally
  await expect(b.locator('#overlay')).toBeHidden();
  expect((await savedBook(b)).transactions.length).toBe(4);
  expect(errors).toEqual([]);
});

test('editing a check: its account lines follow a new payee or memo, unless a line was set on its own', async ({ page }) => {
  const errors = await open(page);
  const check = async () => (await savedBook(page)).transactions.find(t => t.kind === 'payment');
  const editSampleCheck = () => page.click('#register tbody:nth-of-type(1) tr.r1 td:nth-child(3)');

  await editSampleCheck();
  await page.fill('#p-payee', 'Elm St. Car Wash');
  await page.fill('#p-memo', 'Wash only');
  await page.click('#page-check .js-record');
  expect((await check()).splits[0]).toMatchObject({ payee: 'Elm St. Car Wash', memo: 'Wash only' });

  await editSampleCheck();
  await page.fill('#p-splits tr:nth-child(1) .sp-memo', 'Line memo');  // typed on the line itself
  await page.click('#page-check .js-record');
  await editSampleCheck();
  await page.fill('#p-memo', 'Changed again');
  await page.click('#page-check .js-record');
  const t = await check();
  expect(t.memo).toBe('Changed again');
  expect(t.splits[0]).toMatchObject({ payee: 'Elm St. Car Wash', memo: 'Line memo' });
  expect(errors).toEqual([]);
});

test('an account can be renamed by changing only its capital letters; a real clash is still refused', async ({ page }) => {
  await open(page);
  await page.click('.tab[data-tab=lists]');
  await page.selectOption('#l-expense', 'Fuel');
  await page.fill('#l-expense-name', 'FUEL');
  await page.click('[data-list=expense][data-act=rename]');
  await expect(page.locator('#overlay')).toBeHidden();
  const accounts = (await savedBook(page)).expenseAccounts;
  expect(accounts).toContain('FUEL');
  expect(accounts).not.toContain('Fuel');

  await page.selectOption('#l-expense', 'FUEL');
  await page.fill('#l-expense-name', 'maint.');
  await page.click('[data-list=expense][data-act=rename]');
  await expect(page.locator('#dlg-body')).toContainText('already in the list');
});

test('a second message box waits for the first one instead of replacing it', async ({ page }) => {
  await open(page);
  const answers = page.evaluate(() => Promise.all([
    CB.dialog('First', 'one'),
    CB.dialog('Second', 'two', [{ label: 'Yes', value: 'yes', primary: true }])
  ]));
  await expect(page.locator('#dlg-title')).toHaveText('First');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#dlg-title')).toHaveText('Second');
  await page.click('#dlg-buttons button');
  expect(await answers).toEqual([true, 'yes']);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('storage full: unreadable saved data is not overwritten at startup when no rescue copy can be made', async ({ page }) => {
  await page.addInitScript(() => {                                      // rescue copies fail, like a full storage
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('checkbook.rescue.')) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  const errors = await open(page);
  await loadWithStored(page, '{ my real data, damaged');
  await expect(page.locator('#dlg-body')).toContainText('could not keep a rescue copy');
  await page.click('#dlg-buttons button');
  expect(await stored(page)).toBe('{ my real data, damaged');          // not replaced by a fresh book
  await page.reload();
  expect(await stored(page)).toBe('{ my real data, damaged');
  expect(errors).toEqual([]);
});

test('damaged saved data: starting again and again keeps just one rescue copy', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() => { const b = CB.schema.sampleBook(); b.transactions.push(null); return JSON.stringify(b); });
  await loadWithStored(page, bad);
  for (let i = 0; i < 3; i++) await loadWithStored(page, bad);
  expect(await rescues(page)).toEqual([bad]);
});

/* ---------------- void checks (2026.11.13) ---------------- */
async function editMenu(page, cmd) {
  await page.click('#menubar .menu-title:has-text("Edit")');
  await page.click('#menubar [data-cmd=' + cmd + ']');
}
const row = (page, payee) => page.locator('#register tbody', { hasText: payee });
const txnOf = (book, payee) => book.transactions.find(t => t.payee === payee);

test('void: Edit > Void asks first, shows VOID at $0.00, keeps the number, changes nothing else; Unvoid restores it exactly', async ({ page }) => {
  const errors = await open(page);
  await writeCheck(page, 'Gas Co', '40', 'Fuel');                       // check #2
  await expect(page.locator('#sb-current')).toHaveText('$9,960.00');
  const before = await savedBook(page);

  await row(page, 'Gas Co').click();
  await editMenu(page, 'void');
  await expect(page.locator('#dlg-title')).toHaveText('Void Check');
  await expect(page.locator('#dlg-body')).toContainText('Void this check?');
  await expect(page.locator('#dlg-body')).toContainText('counts as $0.00');
  await dlgButton(page, 'Cancel').click();                               // Cancel: nothing changes
  expect(await savedBook(page)).toEqual(before);

  await editMenu(page, 'void');
  await dlgButton(page, 'Void').click();
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(row(page, 'Gas Co').locator('td.void')).toHaveText('VOID');
  await expect(row(page, 'Gas Co').locator('tr.r2')).toContainText('Check — VOID (was $40.00)');
  await expect(row(page, 'Gas Co')).toContainText('2');                  // number still shown
  await expect(row(page, 'Gas Co').locator('.rec-box')).toHaveCount(0);  // Rec. locked while void
  await expect(page.locator('#sb-current')).toHaveText('$10,000.00');    // counts as $0.00
  await expect(page.locator('#sb-count')).toHaveText('3 transactions');  // not deleted

  const after = await savedBook(page);
  const gas = txnOf(after, 'Gas Co');
  expect(typeof gas.voidedAt).toBe('string');
  expect({ ...gas, voidedAt: null }).toEqual(txnOf(before, 'Gas Co'));   // amount, number, splits kept
  expect(after.transactions.filter(t => t.payee !== 'Gas Co')).toEqual(before.transactions.filter(t => t.payee !== 'Gas Co'));

  // the form shows it read-only, with Unvoid
  await expect(page.locator('#page-check')).toHaveClass(/is-void/);
  await expect(page.locator('#page-check .edit-banner')).toContainText('VOID — voided on');
  await expect(page.locator('#p-amount')).toBeDisabled();
  await expect(page.locator('#page-check .js-record')).toBeHidden();
  await expect(page.locator('#p-void')).toHaveText('Unvoid Check');

  // the number is not offered again; Find matches "void"
  await page.click('#page-check .js-clear');
  await expect(page.locator('#p-number')).toHaveValue('3');
  await page.fill('#find', 'void');
  await expect(page.locator('#register tbody')).toHaveCount(1);
  await page.fill('#find', '');

  // still void after a reload; Unvoid puts it back exactly as it was
  await page.reload();
  await expect(row(page, 'Gas Co').locator('td.void')).toHaveText('VOID');
  await row(page, 'Gas Co').click();
  await editMenu(page, 'unvoid');
  await expect(page.locator('#sb-current')).toHaveText('$9,960.00');
  expect(await savedBook(page)).toEqual(before);
  await expect(page.locator('#p-amount')).toBeEnabled();
  await expect(page.locator('#p-void')).toHaveText('Void Check…');
  expect(errors).toEqual([]);
});

test('void: only checks; a reconciled (R) check is refused; a cleared (c) check warns; the form button voids and unvoids', async ({ page }) => {
  const errors = await open(page);
  await editMenu(page, 'void');                                          // nothing selected
  await expect(page.locator('#dlg-body')).toContainText('Click a check in the register first');
  await page.click('#dlg-buttons button');

  await row(page, 'XYZ Corp.').click();                                  // a deposit
  await editMenu(page, 'void');
  await expect(page.locator('#dlg-body')).toContainText('Only checks can be voided');
  await page.click('#dlg-buttons button');
  await expect(page.locator('#p-void')).toBeHidden();

  // cleared check: warning, Cancel is the default
  await row(page, 'Maple St.').locator('.rec-box').click();
  await expect(page.locator('#sb-cleared')).toHaveText('$9,850.00');
  await row(page, 'Maple St.').locator('td').first().click();
  await expect(page.locator('#p-void')).toHaveText('Void Check…');
  await page.click('#p-void');
  await expect(page.locator('#dlg-body')).toContainText('marked c (cleared): the bank has paid it');
  await expect(page.locator('#dlg-buttons .btn.default')).toHaveText('Cancel');
  await dlgButton(page, 'Cancel').click();
  expect(txnOf(await savedBook(page), 'Maple St. Car Wash').voidedAt).toBeNull();
  await page.click('#p-void');
  await dlgButton(page, 'Void Anyway').click();
  await expect(row(page, 'Maple St.').locator('.rec-void')).toHaveText('c');   // c kept, greyed, locked
  await expect(page.locator('#sb-cleared')).toHaveText('$10,000.00');
  await expect(page.locator('#sb-current')).toHaveText('$10,150.00');
  await page.click('#p-void');                                           // Unvoid Check
  await expect(row(page, 'Maple St.').locator('.rec-box')).toHaveText('c');
  await expect(page.locator('#sb-cleared')).toHaveText('$9,850.00');
  expect(txnOf(await savedBook(page), 'Maple St. Car Wash')).toMatchObject({ cleared: true, voidedAt: null, amount: 15000 });

  // reconciled: refused with a message to undo the reconciliation first
  await reconcileSample(page);
  await row(page, 'Maple St.').locator('td').first().click();
  await editMenu(page, 'void');
  await expect(page.locator('#dlg-body')).toContainText('Check #1 is reconciled (R) on the statement dated 11/30/2026');
  await expect(page.locator('#dlg-body')).toContainText('Undo that reconciliation first');
  await page.click('#dlg-buttons button');
  expect(txnOf(await savedBook(page), 'Maple St. Car Wash').voidedAt).toBeNull();
  expect(errors).toEqual([]);
});

test('void: CSV shows VOID and 0.00; deleting a voided check warns that its number is freed', async ({ page }) => {
  const errors = await open(page);
  await writeCheck(page, 'Gas Co', '40', 'Fuel');
  await row(page, 'Gas Co').click();
  await editMenu(page, 'void');
  await dlgButton(page, 'Void').click();

  const lines = await page.evaluate(() => CB.files.buildCsv(CB.app.book).replace(/^﻿/, '').split('\r\n').map(l => l.split(',')));
  expect(lines[0][13]).toBe('Void');
  const gas = lines.find(c => c[4] === 'Gas Co');
  expect([gas[1], gas[5], gas[8], gas[10], gas[13]]).toEqual(['2', '0.00', '10000.00', '0.00', 'VOID (was 40.00)']);
  expect(lines.find(c => c[4] === 'Maple St. Car Wash')[13]).toBe('');
  expect(lines.every(c => c.length === 14)).toBe(true);

  await page.click('.toolbar [data-cmd=delete]');
  await expect(page.locator('#dlg-body')).toContainText('Check #2 is void. Deleting it removes it from the register completely and frees number 2');
  await expect(page.locator('#dlg-buttons .btn.default')).toHaveText('Cancel');
  await dlgButton(page, 'Cancel').click();
  expect(txnOf(await savedBook(page), 'Gas Co')).toBeTruthy();
  expect(errors).toEqual([]);
});

test('void + reconcile: a voided check is not in the tick list, and the hint says to Unvoid it if the bank paid it', async ({ page }) => {
  const errors = await open(page);
  await row(page, 'Maple St.').click();
  await editMenu(page, 'void');
  await dlgButton(page, 'Void').click();

  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');                     // the bank DID pay the $150 check
  await expect(page.locator('#rc-pay tbody tr[data-id]')).toHaveCount(0);
  await page.click('[data-mark=deposit][data-on="1"]');
  await expect(page.locator('#rc-t-diff')).toHaveText('-$150.00');
  await expect(page.locator('#rc-hints .rc-hint-voided')).toContainText('Check #1 to Maple St. Car Wash, $150.00 (11/07/2026) is void. If the bank paid it');
  await page.click('#rc-step2 .js-rc-cancel');

  await row(page, 'Maple St.').click();
  await editMenu(page, 'unvoid');
  await openReconcile(page);
  await startStatement(page, '2026-11-30', '10000');
  await expect(page.locator('#rc-pay tbody tr[data-id]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a version-3 backup file still opens: nothing is voided, and it is saved as version 4', async ({ page }) => {
  const errors = await open(page);
  const v3 = {
    version: 3,
    settings: { company: 'V3 Backup Co', bankAccount: '', beginningBalance: 50000 },
    expenseAccounts: ['Maint.'], incomeAccounts: ['Sales'], payees: [],
    transactions: [
      { id: 'x1', seq: 1, kind: 'payment', type: 'Check', number: '7', date: '2025-05-01', payee: 'Carwash', amount: 2500, memo: '',
        cleared: true, reconciledId: 'r1', splits: [{ account: 'Maint.', amount: 2500, memo: '', payee: 'Carwash' }] },
      { id: 'x2', seq: 2, kind: 'payment', type: 'Check', number: '8', date: '2025-05-02', payee: 'Shell', amount: 1000, memo: '',
        cleared: false, reconciledId: null, splits: [{ account: 'Maint.', amount: 1000, memo: '', payee: 'Shell' }] }
    ],
    reconciliations: [{ id: 'r1', statementDate: '2025-05-31', openingBalance: 50000, endingBalance: 47500, transactionIds: ['x1'],
      finishedAt: '2025-06-02T10:00:00.000Z' }],
    reconcileDraft: null
  };
  const file = path.join(os.tmpdir(), 'cb-v3-backup.json');
  fs.writeFileSync(file, JSON.stringify(v3));
  await page.setInputFiles('#file-open', file);
  await page.click('#dlg-buttons .btn.default'); // Replace
  await expect(page.locator('#sb-current')).toHaveText('$465.00');
  await expect(page.locator('#register td.void')).toHaveCount(0);
  const saved = await savedBook(page);
  expect(saved.version).toBe(4);
  expect(saved.transactions.map(t => [t.voidedAt, t.reconciledId])).toEqual([[null, 'r1'], [null, null]]);
  // and the new feature works on it
  await row(page, 'Shell').click();
  await editMenu(page, 'void');
  await dlgButton(page, 'Void').click();
  await expect(page.locator('#sb-current')).toHaveText('$475.00');
  expect(errors).toEqual([]);
});

test('two windows: a check voided in one window is not undone by the other (it stops saving)', async ({ context }) => {
  const a = await context.newPage();
  const errors = await open(a);
  const b = await context.newPage();
  await open(b);

  await row(b, 'Maple St.').click();                                     // B voids the check
  await editMenu(b, 'void');
  await dlgButton(b, 'Void').click();
  const voidedAt = txnOf(await savedBook(b), 'Maple St. Car Wash').voidedAt;
  expect(typeof voidedAt).toBe('string');
  await expect(a.locator('#dlg-title')).toHaveText('Open in Another Window');
  await dlgButton(a, 'Not Now').click();

  await writeCheck(a, 'From window A', '1', 'Fuel');                    // A's out-of-date copy (check not void) is NOT saved
  await expect(a.locator('#dlg-title')).toHaveText('Open in Another Window');
  const saved = await savedBook(b);
  expect(txnOf(saved, 'Maple St. Car Wash').voidedAt).toBe(voidedAt);
  expect(saved.transactions.map(t => t.payee)).not.toContain('From window A');
  await dlgButton(a, 'Reload').click();
  await expect(row(a, 'Maple St.').locator('td.void')).toHaveText('VOID');
  expect(errors).toEqual([]);
});
