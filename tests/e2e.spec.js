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
