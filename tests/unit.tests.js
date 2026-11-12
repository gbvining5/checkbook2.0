/* =========================================================
   Unit tests for the core logic (js/core). No screen needed.
   Run:  node tests/run-unit.js      (or open tests/unit.html)

   When you fix a bug, ADD A TEST HERE that would have caught it.
   ========================================================= */

/* ---------------- money ---------------- */
test('toCents reads normal amounts', function () {
  eq(CB.money.toCents('150'), 15000);
  eq(CB.money.toCents('150.5'), 15050);
  eq(CB.money.toCents('$1,234.56'), 123456);
  eq(CB.money.toCents('0.07'), 7);
  eq(CB.money.toCents('.5'), 50);
  eq(CB.money.toCents('-20'), -2000);
});

test('toCents rounds half-cents up without floating-point errors', function () {
  eq(CB.money.toCents('1.005'), 101);   // parseFloat("1.005")*100 would give 100 (wrong)
  eq(CB.money.toCents('0.294'), 29);
  eq(CB.money.toCents('19.995'), 2000);
});

test('toCents rejects junk', function () {
  ['', 'abc', '1.2.3', '--5', '$', '.', '12a'].forEach(function (s) {
    ok(isNaN(CB.money.toCents(s)), '"' + s + '" should be rejected');
  });
});

test('format shows dollars with commas', function () {
  eq(CB.money.format(15000), '$150.00');
  eq(CB.money.format(-123456), '-$1,234.56');
  eq(CB.money.format(0), '$0.00');
  eq(CB.money.format(90000000), '$900,000.00');
  eq(CB.money.format(5), '$0.05');
});

test('plain is for inputs and CSV', function () {
  eq(CB.money.plain(15050), '150.50');
  eq(CB.money.plain(-5), '-0.05');
});

test('words writes the check line', function () {
  eq(CB.money.words(15000), 'One Hundred Fifty and 00/100 Dollars');
  eq(CB.money.words(123456789), 'One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven and 89/100 Dollars');
  eq(CB.money.words(100000000), 'One Million and 00/100 Dollars');
  eq(CB.money.words(5), 'Zero and 05/100 Dollars');
  eq(CB.money.words(1101), 'Eleven and 01/100 Dollars');
  eq(CB.money.words(0), '');
});

/* ---------------- ledger ---------------- */
function bookWith(txns, begin) {
  var b = CB.schema.blankBook();
  b.settings.beginningBalance = begin || 0;
  b.transactions = txns.map(function (t, i) {
    return Object.assign({ id: 't' + i, seq: i + 1, kind: 'payment', type: 'Check', number: '', date: '2026-01-01',
      payee: 'X', amount: 100, memo: '', cleared: false }, t, {
      splits: [{ account: 'Maint.', amount: t.amount || 100, memo: '', payee: 'X' }] });
  });
  return b;
}

test('balances: payments subtract, deposits add, cleared tracked separately', function () {
  var b = bookWith([
    { kind: 'payment', amount: 15000, cleared: true },
    { kind: 'deposit', type: 'Deposit', amount: 5000 },
    { kind: 'payment', amount: 2500 }
  ], 100000);
  var r = CB.ledger.balances(b);
  eq(r.current, 100000 - 15000 + 5000 - 2500);
  eq(r.cleared, 100000 - 15000);
});

test('register order: by date, then entry order', function () {
  var b = bookWith([
    { date: '2026-03-01', payee: 'C' },
    { date: '2026-01-15', payee: 'A' },
    { date: '2026-03-01', payee: 'D' },
    { date: '2026-02-01', payee: 'B' }
  ]);
  eq(CB.ledger.sorted(b).map(function (t) { return t.payee; }), ['A', 'B', 'C', 'D']);
});

test('running balance follows register order', function () {
  var b = bookWith([{ date: '2026-02-01', amount: 100 }, { date: '2026-01-01', kind: 'deposit', type: 'Deposit', amount: 500 }], 1000);
  eq(CB.ledger.withRunningBalance(b).map(function (r) { return r.balance; }), [1500, 1400]);
});

test('next check number ignores non-checks and deposits', function () {
  var b = bookWith([
    { type: 'Check', number: '1041' },
    { type: 'Debit Card', number: '9999' },
    { kind: 'deposit', type: 'Deposit', number: '5000' },
    { type: 'Check', number: '1043' }
  ]);
  eq(CB.ledger.nextCheckNumber(b), '1044');
  eq(CB.ledger.nextCheckNumber(CB.schema.blankBook()), '1');
});

test('duplicate check number detection (but editing itself is fine)', function () {
  var b = bookWith([{ type: 'Check', number: '7' }]);
  ok(CB.ledger.isDuplicateCheckNumber(b, '7', null));
  ok(!CB.ledger.isDuplicateCheckNumber(b, '7', 't0'));
  ok(!CB.ledger.isDuplicateCheckNumber(b, '8', null));
});

/* ---------------- schema: validation ---------------- */
test('sample book is valid', function () {
  eq(CB.schema.validate(CB.schema.sampleBook()), []);
});

test('validate catches splits that do not add up', function () {
  var b = bookWith([{ amount: 1000 }]);
  b.transactions[0].splits[0].amount = 900;
  ok(CB.schema.validate(b).some(function (p) { return /add up/.test(p); }));
});

test('validate catches decimal (non-cent) amounts', function () {
  var b = bookWith([{ amount: 150 }]);
  b.transactions[0].amount = 1.5;
  ok(CB.schema.validate(b).length > 0);
});

test('validate catches bad dates, kinds and duplicate ids', function () {
  var b = bookWith([{ amount: 100 }, { amount: 100 }]);
  b.transactions[0].date = '11/07/2026';
  b.transactions[1].kind = 'refund';
  b.transactions[1].id = 't0';
  var p = CB.schema.validate(b).join(' | ');
  ok(/bad date/.test(p) && /unknown kind/.test(p) && /duplicate id/.test(p), p);
});

/* ---------------- schema: migrations ---------------- */
test('version-1 data upgrades to current version', function () {
  var v1 = {
    version: 1,
    settings: { company: 'Old Co', bankAccount: '', beginningBalance: 1000 },
    expenseAccounts: ['Maint.'], incomeAccounts: ['Sales'],
    payees: [{ name: 'Carwash' }],
    transactions: [{ id: 'a', kind: 'payment', type: 'Check', number: 12, date: '2026-01-01', payee: 'Carwash',
      amount: 500, splits: [{ account: 'Maint.', amount: 500, memo: '', payee: 'Carwash' }] }]
  };
  var d = CB.schema.migrate(v1);
  eq(d.version, CB.schema.VERSION);
  eq(d.transactions[0].seq, 1);
  eq(d.transactions[0].cleared, false);
  eq(d.transactions[0].number, '12');
  eq(d.transactions[0].memo, '');
  eq(d.payees[0].address, '');
  eq(CB.schema.validate(d), []);
});

test('data with no version number is treated as version 1', function () {
  var d = CB.schema.migrate({ settings: { beginningBalance: 0 }, expenseAccounts: [], incomeAccounts: [], payees: [], transactions: [] });
  eq(d.version, CB.schema.VERSION);
});

test('data from a NEWER app version is refused, not damaged', function () {
  var e = throws(function () {
    CB.schema.migrate({ version: CB.schema.VERSION + 1, settings: {}, transactions: [] });
  });
  ok(e.newer, 'error should be marked as "newer"');
});

/* ---------------- store: loading & saving safely ---------------- */
// refuse(key) -> true makes setItem throw for that key (like a full browser storage)
function withFakeStorage(initial, fn, refuse) {
  var data = Object.assign({}, initial);
  var fake = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { if (refuse && refuse(k)) throw new Error('QuotaExceededError'); data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    key: function (i) { return Object.keys(data)[i] || null; },
    get length() { return Object.keys(data).length; }
  };
  var real = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
  try { fn(data); }
  finally { if (real) Object.defineProperty(window, 'localStorage', real); else delete window.localStorage; }
}

test('save then load returns the same book', function () {
  withFakeStorage({}, function () {
    var b = CB.schema.sampleBook();
    ok(CB.store.save(b));
    eq(CB.store.load(), b);
    eq(CB.store.warnings, []);
  });
});

test('unreadable saved data is rescued, never silently lost', function () {
  var init = {}; init[CB.store.KEY] = '{ this is not json';
  withFakeStorage(init, function (data) {
    CB.store.load();
    var rescued = Object.keys(data).filter(function (k) { return /^checkbook\.rescue\./.test(k); });
    eq(rescued.length, 1, 'a rescue copy should exist');
    eq(data[rescued[0]], '{ this is not json');
    ok(CB.store.warnings.length > 0, 'user should be warned');
  });
});

test('old data is upgraded and the original is kept', function () {
  var v1 = { version: 1, settings: { company: 'A', bankAccount: '', beginningBalance: 0 }, expenseAccounts: [], incomeAccounts: [], payees: [], transactions: [] };
  var init = {}; init[CB.store.KEY] = JSON.stringify(v1);
  withFakeStorage(init, function (data) {
    var b = CB.store.load();
    eq(b.version, CB.schema.VERSION);
    ok(data['checkbook.before-upgrade.v1'], 'original v1 copy should be kept');
  });
});

test('data from a newer version blocks saving so it is not overwritten', function () {
  var newer = { version: 99, settings: {}, transactions: [] };
  var init = {}; init[CB.store.KEY] = JSON.stringify(newer);
  withFakeStorage(init, function (data) {
    CB.store.load();
    ok(CB.store.saveBlocked, 'saving should be blocked');
    eq(CB.store.save(CB.schema.blankBook()), false);
    eq(JSON.parse(data[CB.store.KEY]).version, 99, 'newer data must be untouched');
    CB.store.unblock(true);
  });
});

function rescueKeys(data, value) {
  return Object.keys(data).filter(function (k) { return k.indexOf('checkbook.rescue.') === 0 && (value === undefined || data[k] === value); });
}

test('saving stays off until the newer data has a rescue copy', function () {
  var newer = JSON.stringify({ version: 99, settings: { company: 'Future' }, transactions: [] });
  var init = {}; init[CB.store.KEY] = newer;
  withFakeStorage(init, function (data) {
    CB.store.load();
    eq(CB.store.blockedRaw(), newer);
    eq(CB.store.unblock(), false, 'no rescue copy yet: refuse');
    eq(CB.store.save(CB.schema.blankBook()), false);
    ok(CB.store.keepRescue());
    eq(rescueKeys(data, newer).length, 1, 'the newer data survives in a rescue copy');
    ok(CB.store.keepRescue(), 'asking again does not make a second copy');
    eq(rescueKeys(data).length, 1);
    eq(CB.store.unblock(), true);
    ok(CB.store.save(CB.schema.blankBook()), 'saving works again');
  });
});

test('if the rescue copy cannot be written (storage full), the newer data is not overwritten', function () {
  var newer = JSON.stringify({ version: 99, settings: { company: 'Future' }, transactions: [] });
  var init = {}; init[CB.store.KEY] = newer;
  withFakeStorage(init, function (data) {
    CB.store.load();
    eq(CB.store.keepRescue(), false, 'rescue copy failed');
    eq(CB.store.unblock(), false, 'so saving stays off');
    eq(CB.store.save(CB.schema.blankBook()), false);
    eq(data[CB.store.KEY], newer, 'newer data untouched');
    eq(CB.store.unblock(true), true, 'only once the user confirms they have the downloaded file');
  }, function (k) { return k.indexOf('checkbook.rescue.') === 0; });
});

test('findDamage: only damage the screens cannot draw', function () {
  var D = CB.schema.findDamage;
  function damaged(f) { var b = CB.schema.sampleBook(); f(b); return D(b); }
  eq(D(CB.schema.sampleBook()), null);
  eq(damaged(function (b) { b.transactions.push(null); }), 'transaction 3 cannot be read');
  eq(damaged(function (b) { delete b.transactions[0].splits; }), 'transaction 1 has no account lines');
  eq(damaged(function (b) { b.transactions[1].splits = [null]; }), 'transaction 2 has an account line that cannot be read');
  eq(damaged(function (b) { b.payees.push(null); }), 'payee ' + (CB.schema.sampleBook().payees.length + 1) + ' cannot be read');
  eq(damaged(function (b) { delete b.payees; }), 'the "payees" list is missing');
  eq(damaged(function (b) { delete b.expenseAccounts; }), 'the "expenseAccounts" list is missing');
  eq(damaged(function (b) { b.reconciliations.push(5); }), 'reconciliation 1 cannot be read');
  // these are warnings (validate), not damage: the screens cope with them
  eq(damaged(function (b) { b.transactions[0].date = 'xx'; }), null);
  eq(damaged(function (b) { b.transactions[0].amount = 1; }), null);
  eq(damaged(function (b) { delete b.reconciliations; }), null);
});

test('damaged saved data is not shown or overwritten: saving off, rescue copy kept', function () {
  var b = CB.schema.sampleBook(); b.transactions.push(null);
  var raw = JSON.stringify(b);
  var init = {}; init[CB.store.KEY] = raw;
  withFakeStorage(init, function (data) {
    var loaded = CB.store.load();
    eq(loaded.transactions, [], 'a blank stand-in is shown');
    ok(CB.store.saveBlocked);
    eq(CB.store.save(CB.schema.blankBook()), false);
    eq(data[CB.store.KEY], raw, 'stored data untouched');
    eq(rescueKeys(data, raw).length, 1);
    ok(/damaged \(transaction 3 cannot be read\)/.test(CB.store.warnings[0]), CB.store.warnings[0]);
    eq(CB.store.unblock(), true, 'it already has a rescue copy');
  });
});

test('old-version data whose upgrade crashes on a damaged entry is reported as damaged', function () {
  var v1 = { version: 1, settings: { company: 'A', bankAccount: '', beginningBalance: 0 }, expenseAccounts: [], incomeAccounts: [], payees: [], transactions: [null] };
  var init = {}; init[CB.store.KEY] = JSON.stringify(v1);
  withFakeStorage(init, function () {
    CB.store.load();
    ok(CB.store.saveBlocked);
    ok(/damaged \(it cannot be upgraded\)/.test(CB.store.warnings[0]), CB.store.warnings[0]);
    CB.store.unblock(true);
  });
  ok(/damaged/.test(throws(function () { CB.store.parseBackup(JSON.stringify(v1)); }).message));
});

test('rescue copies are listed newest first and only they can be read back', function () {
  var init = { 'checkbook.rescue.1000': 'old', 'checkbook.rescue.3000': 'new', 'checkbook.before-upgrade.v2': 'v2', other: 'x' };
  init[CB.store.KEY] = '{}';
  withFakeStorage(init, function () {
    eq(CB.store.listRescues().map(function (r) { return [r.key, r.kind]; }),
      [['checkbook.rescue.3000', 'rescue'], ['checkbook.rescue.1000', 'rescue'], ['checkbook.before-upgrade.v2', 'before-upgrade']]);
    eq(CB.store.listRescues()[0].time, 3000);
    eq(CB.store.readRescue('checkbook.rescue.1000'), 'old');
    eq(CB.store.readRescue('other'), null);
    eq(CB.store.readRescue(CB.store.KEY), null);
  });
});

test('parseBackup refuses damaged entries that would blank the register', function () {
  var b = CB.schema.sampleBook();
  b.transactions.push(null);
  ok(/damaged/.test(throws(function () { CB.store.parseBackup(JSON.stringify(b)); }).message));
  b = CB.schema.sampleBook();
  delete b.transactions[0].splits;
  ok(/damaged/.test(throws(function () { CB.store.parseBackup(JSON.stringify(b)); }).message));  // these crashed the screens too, but got through the first fix
  b = CB.schema.sampleBook(); b.transactions[0].splits = [null];
  ok(/damaged \(transaction 1 has an account line/.test(throws(function () { CB.store.parseBackup(JSON.stringify(b)); }).message));
  b = CB.schema.sampleBook(); b.payees.push(null);
  ok(/damaged/.test(throws(function () { CB.store.parseBackup(JSON.stringify(b)); }).message));
  b = CB.schema.sampleBook(); delete b.expenseAccounts;
  ok(/damaged/.test(throws(function () { CB.store.parseBackup(JSON.stringify(b)); }).message));
});

test('parseBackup rejects files that are not checkbooks', function () {
  throws(function () { CB.store.parseBackup('hello'); });
  throws(function () { CB.store.parseBackup('{"name":"not a checkbook"}'); });
  var r = CB.store.parseBackup(JSON.stringify(CB.schema.sampleBook()));
  eq(r.problems, []);
});

/* ---------------- ledger: checkTxn (shared by the forms and Reconcile) ---------------- */
function txnFields(over) {
  return Object.assign({ kind: 'payment', type: 'Bank Fee', number: '', date: '2026-01-31', payee: 'Bank', amount: 1500,
    splits: [{ account: 'Bank Fees', amount: 1500, memo: '', payee: 'Bank' }], editingId: null }, over);
}
function messages(errs) { return errs.map(function (e) { return e.message; }).join(' | '); }

test('checkTxn accepts a good transaction', function () {
  eq(CB.ledger.checkTxn(CB.schema.blankBook(), txnFields({})), []);
});

test('checkTxn requires an account (same rule as Write Check)', function () {
  var errs = CB.ledger.checkTxn(CB.schema.blankBook(), txnFields({ splits: [{ account: '', amount: 1500, memo: '', payee: 'Bank' }] }));
  eq(errs.length, 1);
  eq(errs[0].field, 'account');
  eq(errs[0].split, 0);
  ok(/Choose an account/.test(errs[0].message));
});

test('checkTxn: payee, amount, lines that do not add up, duplicate check number', function () {
  var b = bookWith([{ type: 'Check', number: '7' }]);
  var m = messages(CB.ledger.checkTxn(b, txnFields({ payee: '', amount: NaN })));
  ok(/who you paid/.test(m) && /greater than zero/.test(m), m);
  m = messages(CB.ledger.checkTxn(b, txnFields({ amount: 2000 })));
  ok(/add up to \$15\.00 but the total is \$20\.00/.test(m), m);
  m = messages(CB.ledger.checkTxn(b, txnFields({ type: 'Check', number: '7' })));
  ok(/Check #7 is already/.test(m), m);
  eq(CB.ledger.checkTxn(b, txnFields({ type: 'Check', number: '7', editingId: 't0' })), [], 'editing itself is fine');
});

test('checkTxn refuses decimal (non-cent) amounts', function () {
  ok(CB.ledger.checkTxn(CB.schema.blankBook(), txnFields({ amount: 15.5, splits: [{ account: 'Bank Fees', amount: 15.5 }] })).length > 0);
});

// Bug fix: two blank account lines used to be skipped, so a check with NO account lines got recorded.
test('checkTxn refuses a transaction with no account lines at all', function () {
  var errs = CB.ledger.checkTxn(CB.schema.blankBook(), txnFields({ splits: [] }));
  ok(errs.some(function (e) { return e.field === 'account'; }), messages(errs));
});

/* ---------------- reconcile ---------------- */
var R = CB.reconcile;
// Beginning 1000.00; t0 check 150.00 (cleared), t1 deposit 50.00, t2 check 25.00 dated after the statement
function recBook() {
  var b = bookWith([
    { kind: 'payment', amount: 15000, date: '2026-01-10', cleared: true },
    { kind: 'deposit', type: 'Deposit', amount: 5000, date: '2026-01-20' },
    { kind: 'payment', amount: 2500, date: '2026-02-05' }
  ], 100000);
  b.transactions.forEach(function (t) { t.reconciledId = null; });
  return b;
}

test('difference = statement balance - (opening + ticked items)', function () {
  var b = recBook();
  var s = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] };
  eq(R.clearedTotal(b, s.tickedIds), 100000 - 15000 + 5000);
  eq(R.difference(b, s), 0);
  s.tickedIds = ['t0'];
  eq(R.difference(b, s), 90000 - 85000);
  s.tickedIds = [];
  eq(R.difference(b, s), -10000);
  s.tickedIds = ['t0', 't0', 'gone'];   // duplicates and deleted ids are ignored
  eq(R.clearedTotal(b, s.tickedIds), 85000);
});

test('opening balance: beginning balance first time, then the last reconciliation ending balance', function () {
  var b = recBook();
  eq(R.openingBalance(b), 100000);
  R.finish(b, { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] }, 'r1', '2026-02-02T10:00:00.000Z');
  eq(R.openingBalance(b), 90000);
  b.settings.beginningBalance = 1;      // no longer used once a statement is reconciled
  eq(R.openingBalance(b), 90000);
  // next statement starts from 900.00
  eq(R.difference(b, { statementDate: '2026-02-28', endingBalance: 87500, tickedIds: ['t2'] }), 0);
});

test('Finish is refused unless the difference is exactly 0 cents, and changes nothing', function () {
  var b = recBook();
  var before = JSON.stringify(b);
  var s = { statementDate: '2026-01-31', endingBalance: 90001, tickedIds: ['t0', 't1'] };   // off by 1 cent
  eq(R.canFinish(b, s).ok, false);
  throws(function () { R.finish(b, s, 'r1', 'now'); });
  eq(JSON.stringify(b), before, 'book must be untouched');
  s.endingBalance = 90000.5;                                                                 // not whole cents
  eq(R.canFinish(b, s).ok, false);
  s.endingBalance = 90000;
  eq(R.canFinish(b, s).ok, true);
});

test('Finish locks ticked items, records the statement, clears the draft, leaves others alone', function () {
  var b = recBook();
  b.reconcileDraft = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0'] };
  var rec = R.finish(b, { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] }, 'r1', '2026-02-02T10:00:00.000Z');
  eq(rec, { id: 'r1', statementDate: '2026-01-31', openingBalance: 100000, endingBalance: 90000,
    transactionIds: ['t0', 't1'], finishedAt: '2026-02-02T10:00:00.000Z' });
  eq(b.reconciliations, [rec]);
  eq(b.reconcileDraft, null);
  eq([b.transactions[0].reconciledId, b.transactions[1].reconciledId, b.transactions[2].reconciledId], ['r1', 'r1', null]);
  eq([b.transactions[0].cleared, b.transactions[1].cleared, b.transactions[2].cleared], [true, true, false]);
  eq(CB.ledger.balances(b).cleared, 90000, 'status-bar cleared balance agrees with the statement');
  eq(CB.schema.validate(b), []);
});

test('lists unreconciled items up to the statement date; later ones only when asked or ticked', function () {
  var b = recBook();
  var s = { statementDate: '2026-01-31', endingBalance: 0, tickedIds: [] };
  function ids(list) { return list.map(function (t) { return t.id; }); }
  eq(ids(R.candidates(b, s, false)), ['t0', 't1']);
  eq(ids(R.candidates(b, s, true)), ['t0', 't1', 't2']);
  s.tickedIds = ['t2'];
  eq(ids(R.candidates(b, s, false)), ['t0', 't1', 't2'], 'ticked items stay visible');
  b.transactions[0].reconciledId = 'old';
  eq(ids(R.candidates(b, s, true)), ['t1', 't2'], 'reconciled items are not listed');
});

test('items already marked cleared start ticked (only up to the statement date)', function () {
  var b = recBook();
  b.transactions[2].cleared = true;     // dated after the statement
  eq(R.initialTicks(b, '2026-01-31'), ['t0']);
});

test('statement date cannot be before the last reconciled statement; balance must be whole cents', function () {
  var b = recBook();
  eq(R.checkStart(b, '2026-01-31', 90000), []);
  ok(R.checkStart(b, '', 90000).length === 1);
  ok(R.checkStart(b, '2026-01-31', NaN).length === 1);
  ok(R.checkStart(b, '2026-01-31', 900.5).length === 1);
  eq(R.checkStart(b, '2026-01-31', -500), [], 'an overdrawn statement is allowed');
  R.finish(b, { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] }, 'r1', 'x');
  ok(/before the last reconciled statement/.test(R.checkStart(b, '2026-01-30', 1).join(' ')));
  eq(R.checkStart(b, '2026-01-31', 1), [], 'the same date is allowed');
});

test('leaving unfinished and coming back keeps the ticks (through save and load)', function () {
  withFakeStorage({}, function () {
    var b = recBook();
    var s = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t1', 't0'] };
    b.reconcileDraft = R.makeDraft(s);
    s.tickedIds.push('t2');             // later changes to the session don't leak into the saved draft
    ok(CB.store.save(b));
    var loaded = CB.store.load();
    eq(R.resume(loaded), { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t1', 't0'] });
    eq(loaded.transactions.map(function (t) { return t.reconciledId; }), [null, null, null], 'no transaction changed');
  });
});

test('resuming drops ticks for transactions that were deleted since', function () {
  var b = recBook();
  b.reconcileDraft = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] };
  b.transactions = b.transactions.filter(function (t) { return t.id !== 't1'; });
  eq(R.resume(b).tickedIds, ['t0']);
  b.reconcileDraft = null;
  eq(R.resume(b), null);
});

test('sameSession compares ticks as sets', function () {
  var a = { statementDate: '2026-01-31', endingBalance: 1, tickedIds: ['a', 'b'] };
  ok(R.sameSession(a, { statementDate: '2026-01-31', endingBalance: 1, tickedIds: ['b', 'a'] }));
  ok(!R.sameSession(a, { statementDate: '2026-01-31', endingBalance: 1, tickedIds: ['a'] }));
  ok(!R.sameSession(a, { statementDate: '2026-01-31', endingBalance: 1, tickedIds: null }));
});

/* ---------------- schema: version 2 -> 3 (reconciliation) ---------------- */
function v2Book() {
  return {
    version: 2,
    settings: { company: 'V2 Co', bankAccount: '', beginningBalance: 100000 },
    expenseAccounts: ['Maint.'], incomeAccounts: ['Sales'], payees: [],
    transactions: [
      { id: 'a', seq: 1, kind: 'payment', type: 'Check', number: '1', date: '2026-01-05', payee: 'X', amount: 500, memo: '',
        cleared: true, splits: [{ account: 'Maint.', amount: 500, memo: '', payee: 'X' }] },
      { id: 'b', seq: 2, kind: 'deposit', type: 'Deposit', number: '', date: '2026-01-06', payee: 'Y', amount: 900, memo: '',
        cleared: false, splits: [{ account: 'Sales', amount: 900, memo: '', payee: 'Y' }] }
    ]
  };
}

test('version-2 data upgrades to version 3 and keeps cleared ticks as they were', function () {
  var d = CB.schema.migrate(v2Book());
  eq(d.version, 3);
  eq(CB.schema.VERSION, 3);
  eq(d.reconciliations, []);
  eq(d.reconcileDraft, null);
  eq(d.transactions.map(function (t) { return [t.cleared, t.reconciledId]; }), [[true, null], [false, null]]);
  eq(CB.ledger.balances(d), { current: 100400, cleared: 99500 }, 'balances unchanged by the upgrade');
  eq(CB.schema.validate(d), []);
});

test('a version-2 book in storage loads, upgrades, and the original is kept', function () {
  var init = {}; init[CB.store.KEY] = JSON.stringify(v2Book());
  withFakeStorage(init, function (data) {
    var b = CB.store.load();
    eq(b.version, 3);
    eq(CB.store.warnings, []);
    eq(JSON.parse(data['checkbook.before-upgrade.v2']).version, 2, 'original v2 copy should be kept');
  });
});

test('validate catches broken reconciliation data', function () {
  var b = recBook();
  b.transactions[0].reconciledId = 'nope';
  b.reconciliations.push({ id: 'r1', statementDate: '01/31/2026', openingBalance: 1.5, endingBalance: 0, transactionIds: [] });
  b.reconcileDraft = { statementDate: '2026-01-31', endingBalance: 'abc', tickedIds: [] };
  var p = CB.schema.validate(b).join(' | ');
  ok(/does not exist/.test(p) && /bad statement date/.test(p) && /whole number of cents/.test(p) && /unfinished reconciliation/.test(p), p);
});

/* ---------------- reconcile part 2: hints ---------------- */
function hintIds(list) { return list.map(function (t) { return t.id; }); }

test('hint 1: difference equals one unticked item (and in the right direction)', function () {
  var b = recBook();
  var s = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0'] };   // the $50 deposit t1 is not ticked
  eq(hintIds(R.hintUnticked(b, s)), ['t1']);
  var h = R.hints(b, s).filter(function (x) { return x.rule === 'unticked'; });
  eq(h.length, 1);
  eq(h[0].text, 'Did X, $50.00 (01/20/2026) clear?');
  s.endingBalance = 90001;                                                            // off by 50.01: no item matches
  eq(R.hintUnticked(b, s), []);
  s.endingBalance = 80000;                                                            // off by -50.00: a deposit can't fix that
  eq(R.hintUnticked(b, s), []);
  s = { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] }; // balances: no hints at all
  eq(R.hints(b, s), []);
});

test('hint 1 never suggests an item that is already reconciled', function () {
  var b = recBook();
  b.transactions[1].reconciledId = 'old';
  b.reconciliations.push({ id: 'old', statementDate: '2025-12-31', openingBalance: 0, endingBalance: 100000, transactionIds: ['t1'], finishedAt: '' });
  eq(R.hintUnticked(b, { statementDate: '2026-01-31', endingBalance: 105000, tickedIds: [] }), []);
});

test('hint 2: difference equals twice a ticked item (entered as the wrong kind)', function () {
  var b = recBook();
  // bank treated the $50 as a payment: 1000 - 150 - 50 = 800, but the register has it as a deposit
  var s = { statementDate: '2026-01-31', endingBalance: 80000, tickedIds: ['t0', 't1'] };
  eq(hintIds(R.hintReversed(b, s)), ['t1']);
  var h = R.hints(b, s).filter(function (x) { return x.rule === 'reversed'; });
  eq(h[0].text, 'Check that X, $50.00 (01/20/2026) isn’t entered as a deposit instead of a payment.');
  s.endingBalance = 80001;
  eq(R.hintReversed(b, s), [], 'not exactly twice');
  s.endingBalance = 100000;                                    // +100.00 is twice $50 but in the wrong direction
  eq(R.hintReversed(b, s), []);
  // an UNticked item can't cause a doubled difference
  eq(R.hintReversed(b, { statementDate: '2026-01-31', endingBalance: 75000, tickedIds: ['t0'] }), []);
  // a ticked payment that should have been a deposit
  eq(hintIds(R.hintReversed(b, { statementDate: '2026-01-31', endingBalance: 120000, tickedIds: ['t0', 't1'] })), ['t0']);
});

test('hint 3: difference divisible by 9 suggests swapped digits', function () {
  eq(R.hintTransposed(900), true, '$54.00 entered as $45.00');
  eq(R.hintTransposed(-900), true);
  eq(R.hintTransposed(27), true, '0.72 vs 0.45... any multiple of 9 cents');
  eq(R.hintTransposed(0), false);
  eq(R.hintTransposed(10), false);
  eq(R.hintTransposed(901), false);
  var b = recBook();
  var h = R.hints(b, { statementDate: '2026-01-31', endingBalance: 90900, tickedIds: ['t0', 't1'] });   // off by $9.00
  eq(h.map(function (x) { return x.rule; }), ['transposed']);
  eq(h[0].text, 'Two digits may be swapped (like 45 vs 54).');
  eq(R.hints(b, { statementDate: '2026-01-31', endingBalance: 90010, tickedIds: ['t0', 't1'] }), [], 'off by 10 cents: no hint');
});

/* ---------------- reconcile part 2: undo ---------------- */
function twoRecs() {
  var b = recBook();
  R.finish(b, { statementDate: '2026-01-31', endingBalance: 90000, tickedIds: ['t0', 't1'] }, 'r1', '2026-02-02T15:00:00.000Z');
  R.finish(b, { statementDate: '2026-02-28', endingBalance: 87500, tickedIds: ['t2'] }, 'r2', '2026-03-02T15:00:00.000Z');
  return b;
}

test('undo only works on the most recent reconciliation', function () {
  var b = twoRecs();
  var before = JSON.stringify(b);
  eq(R.canUndo(b, 'r1').ok, false);
  throws(function () { R.undoLast(b, 'r1'); });
  throws(function () { R.undoLast(b, 'nope'); });
  eq(JSON.stringify(b), before, 'refused undo changes nothing');

  var rec = R.undoLast(b, 'r2');
  eq(rec.id, 'r2');
  eq(b.reconciliations.map(function (r) { return r.id; }), ['r1']);
  eq([b.transactions[2].reconciledId, b.transactions[2].cleared], [null, true], 'back to cleared, not reconciled');
  eq([b.transactions[0].reconciledId, b.transactions[1].reconciledId], ['r1', 'r1'], 'earlier one untouched');
  eq(R.openingBalance(b), 90000);
  eq(CB.schema.validate(b), []);
  eq(R.canUndo(b, 'r1').ok, true, 'r1 is now the most recent');
  R.undoLast(b, 'r1');
  eq(b.reconciliations, []);
  eq(R.canUndo(b, 'r1').ok, false, 'nothing left to undo');
});

test('undo is refused while an unfinished reconciliation is saved', function () {
  var b = twoRecs();
  b.reconcileDraft = { statementDate: '2026-03-31', endingBalance: 1, tickedIds: [] };
  eq(R.canUndo(b, 'r2').ok, false);
  throws(function () { R.undoLast(b, 'r2'); });
  eq(b.reconciliations.length, 2);
});

/* ---------------- reconcile part 2: report ---------------- */
test('report totals: cleared payments/deposits, outstanding items, and it adds up', function () {
  var b = recBook();
  b.transactions.push(Object.assign({}, b.transactions[0], { id: 't3', seq: 4, amount: 1000, date: '2026-01-25', cleared: false,
    splits: [{ account: 'Maint.', amount: 1000, memo: '', payee: 'X' }] }));
  b.transactions.push(Object.assign({}, b.transactions[0], { id: 't4', seq: 5, amount: 700, date: '2026-01-26', cleared: false,
    splits: [{ account: 'Maint.', amount: 700, memo: '', payee: 'X' }] }));
  R.finish(b, { statementDate: '2026-01-31', endingBalance: 89300, tickedIds: ['t0', 't1', 't4'] }, 'r1', '2026-02-02T15:00:00.000Z');
  var r = R.report(b, 'r1');
  eq([r.statementDate, r.openingBalance, r.endingBalance], ['2026-01-31', 100000, 89300]);
  eq(r.payments, { count: 2, total: 15700 });
  eq(r.deposits, { count: 1, total: 5000 });
  eq(hintIds(r.outstanding), ['t3'], 'unticked and on/before the statement date; t2 is dated later');
  eq([r.offBy, r.deletedCount], [0, 0]);

  // a later statement reconciles t3: the first report still lists it as outstanding back then
  R.finish(b, { statementDate: '2026-02-28', endingBalance: 85800, tickedIds: ['t2', 't3'] }, 'r2', '2026-03-02T15:00:00.000Z');
  eq(hintIds(R.report(b, 'r1').outstanding), ['t3']);
  var r2 = R.report(b, 'r2');
  eq([r2.openingBalance, r2.payments, r2.deposits, r2.outstanding, r2.offBy], [89300, { count: 2, total: 3500 }, { count: 0, total: 0 }, [], 0]);
  eq(R.report(b, 'nope'), null);
});

test('report shows when a past reconciliation no longer adds up', function () {
  var b = twoRecs();
  b.transactions[0].amount = 15100;   // edited after the warning
  b.transactions = b.transactions.filter(function (t) { return t.id !== 't1'; });   // deleted after the warning
  var r = R.report(b, 'r1');
  eq(r.deletedCount, 1);
  eq(r.payments, { count: 1, total: 15100 });
  eq(r.offBy, 90000 - (100000 - 15100));
});

/* ---------------- reconcile part 2: protecting reconciled items ---------------- */
test('only amount, date or kind changes to a reconciled item need the warning', function () {
  var b = twoRecs();
  var t = b.transactions[0];
  ok(R.changeNeedsWarning(t, { amount: 15001 }), 'amount');
  ok(R.changeNeedsWarning(t, { date: '2026-01-11' }), 'date');
  ok(R.changeNeedsWarning(t, { kind: 'deposit' }), 'kind');
  ok(!R.changeNeedsWarning(t, { amount: 15000, date: '2026-01-10', kind: 'payment', memo: 'new', payee: 'Y' }), 'memo/payee/same values');
  ok(!R.changeNeedsWarning(recBook().transactions[0], { amount: 1 }), 'not reconciled');
  ok(/^This was reconciled on \d\d\/\d\d\/2026 \(statement dated 01\/31\/2026\)\. Changing it will make that reconciliation wrong\.$/.test(R.warningFor(b, t)), R.warningFor(b, t));
  eq(R.warningFor(b, recBook().transactions[0]), null);
  eq(R.beginningBalanceWarning(recBook()), null);
  ok(/statement dated 01\/31\/2026/.test(R.beginningBalanceWarning(b)), 'uses the first reconciliation');
});

/* ---------------- app version ---------------- */
test('app version is the release date (YEAR.MONTH.DAY, optional -N)', function () {
  ok(/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(CB.APP_VERSION), CB.APP_VERSION);
  ok(CB.util.isIsoDate(CB.APP_VERSION.slice(0, 10).replace(/\./g, '-')), 'a real date');
});

/* ---------------- safety ---------------- */
test('esc() neutralises HTML in user text', function () {
  eq(CB.util.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});
