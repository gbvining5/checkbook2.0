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
function withFakeStorage(initial, fn) {
  var data = Object.assign({}, initial);
  var fake = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
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
    CB.store.unblock();
  });
});

test('parseBackup rejects files that are not checkbooks', function () {
  throws(function () { CB.store.parseBackup('hello'); });
  throws(function () { CB.store.parseBackup('{"name":"not a checkbook"}'); });
  var r = CB.store.parseBackup(JSON.stringify(CB.schema.sampleBook()));
  eq(r.problems, []);
});

/* ---------------- safety ---------------- */
test('esc() neutralises HTML in user text', function () {
  eq(CB.util.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});
