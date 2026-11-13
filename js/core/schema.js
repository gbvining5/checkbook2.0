/* =========================================================
   CB.schema — the shape of a checkbook's saved data.

   *** READ THIS BEFORE CHANGING THE DATA FORMAT ***
   People's checkbooks live only in their own browser / backup
   files. We can never "fix their data on the server". So:
     1. Bump VERSION by 1.
     2. Add a migration MIGRATIONS[oldVersion] that upgrades
        old data to the new shape.
     3. Add a unit test that an old-version book still loads.
   Never remove a migration.

   Data shape (VERSION 4):
   {
     version: 4,
     settings: { company: string, bankAccount: string, beginningBalance: cents },
     expenseAccounts: [string], incomeAccounts: [string],
     payees: [{ name, address, city }],
     transactions: [{
       id: string, seq: integer (entry order),
       kind: 'payment' | 'deposit',
       type: 'Check' | 'Debit Card' | 'Electronic (ACH)' | 'Bank Fee' | 'Other' | 'Deposit',
       number: string, date: 'YYYY-MM-DD', payee: string,
       amount: cents (positive integer), memo: string, cleared: boolean,
       reconciledId: null | string,                        // id of the reconciliation that locked it (v3)
       voidedAt: null | ISO date-time string,              // when it was voided; null = not void (v4). Checks only.
                                                           // A voided check keeps its amount/splits but counts as $0.00:
                                                           // use CB.ledger.amountOf()/signed(), never t.amount, for money math.
       splits: [{ account, amount: cents, memo, payee }]   // amounts add up to `amount`
     }],
     reconciliations: [{                                   // finished statements, oldest first (v3)
       id: string, statementDate: 'YYYY-MM-DD',
       openingBalance: cents, endingBalance: cents,
       transactionIds: [string], finishedAt: ISO date-time string
     }],
     reconcileDraft: null | { statementDate, endingBalance: cents, tickedIds: [string] }  // unfinished session (v3)
   }
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.schema = (function () {
  'use strict';

  var VERSION = 4;
  var KINDS = ['payment', 'deposit'];

  function blankBook() {
    return {
      version: VERSION,
      settings: { company: 'My Company', bankAccount: '', beginningBalance: 0 },
      expenseAccounts: ['Maint.', 'Fuel', 'Office Supplies', 'Payroll', 'Utilities', 'Rent', 'Insurance', 'Bank Fees', 'Other Expense'],
      incomeAccounts: ['Sales', 'Services', 'Interest', 'Other Income'],
      payees: [],
      transactions: [],
      reconciliations: [],
      reconcileDraft: null
    };
  }

  function sampleBook() {
    var uid = CB.util.uid;
    var b = blankBook();
    // Made-up example data only: no real people, companies or addresses.
    b.settings = { company: 'ABC Co.', bankAccount: '', beginningBalance: 1000000 };   // $10,000.00
    b.payees = [
      { name: 'Maple St. Car Wash', address: '123 Maple St.', city: 'Anytown, ST 12345' },
      { name: 'XYZ Corp.', address: '', city: '' }
    ];
    b.transactions = [
      { id: uid(), seq: 1, kind: 'payment', type: 'Check', number: '1', date: '2026-11-07', payee: 'Maple St. Car Wash',
        amount: 15000, memo: 'Detail & Wax', cleared: false, reconciledId: null, voidedAt: null,
        splits: [{ account: 'Maint.', amount: 15000, memo: 'Detail & Wax', payee: 'Maple St. Car Wash' }] },
      { id: uid(), seq: 2, kind: 'deposit', type: 'Deposit', number: '', date: '2026-11-07', payee: 'XYZ Corp.',
        amount: 15000, memo: '', cleared: false, reconciledId: null, voidedAt: null,
        splits: [{ account: 'Services', amount: 15000, memo: '', payee: 'XYZ Corp.' }] }
    ];
    return b;
  }

  /* ---------- migrations: MIGRATIONS[n] upgrades version n -> n+1 ---------- */
  var MIGRATIONS = {
    // v1 -> v2: fill in fields older builds could leave out
    1: function (d) {
      var seq = 0;
      (d.transactions || []).forEach(function (t) {
        if (typeof t.seq !== 'number') t.seq = ++seq; else seq = Math.max(seq, t.seq);
        if (typeof t.cleared !== 'boolean') t.cleared = !!t.cleared;
        if (typeof t.memo !== 'string') t.memo = t.memo ? String(t.memo) : '';
        if (typeof t.number !== 'string') t.number = t.number == null ? '' : String(t.number);
        if (!Array.isArray(t.splits)) t.splits = [];
      });
      (d.payees || []).forEach(function (p) {
        if (typeof p.address !== 'string') p.address = '';
        if (typeof p.city !== 'string') p.city = '';
      });
      d.version = 2;
      return d;
    },
    // v2 -> v3: reconciliation (nothing is reconciled yet; existing `cleared` ticks are kept as they are)
    2: function (d) {
      (d.transactions || []).forEach(function (t) {
        if (t && typeof t === 'object' && t.reconciledId === undefined) t.reconciledId = null;
      });
      if (!Array.isArray(d.reconciliations)) d.reconciliations = [];
      if (d.reconcileDraft === undefined) d.reconcileDraft = null;
      d.version = 3;
      return d;
    },
    // v3 -> v4: void checks (nothing is voided yet)
    3: function (d) {
      (d.transactions || []).forEach(function (t) {
        if (t && typeof t === 'object' && t.voidedAt === undefined) t.voidedAt = null;
      });
      d.version = 4;
      return d;
    }
  };

  // Upgrade data to the current VERSION. Throws a readable Error if it can't.
  function migrate(data) {
    if (!data || typeof data !== 'object') throw new Error('This is not CheckBook data.');
    if (data.version == null) data.version = 1;
    if (typeof data.version !== 'number') throw new Error('The data has an unknown version.');
    if (data.version > VERSION) {
      var e = new Error('This checkbook was saved by a newer version of CheckBook (data version ' +
        data.version + '). Update the app before opening it.');
      e.newer = true;
      throw e;
    }
    while (data.version < VERSION) {
      var step = MIGRATIONS[data.version];
      if (!step) throw new Error('No upgrade path from data version ' + data.version + '.');
      data = step(data);
    }
    return data;
  }

  var isCents = CB.money.isCents;

  // Check a book for problems. Returns a list of plain-English problems ([] = all good).
  function validate(d) {
    var p = [];
    if (!d || typeof d !== 'object') return ['Not a checkbook.'];
    if (!d.settings || typeof d.settings !== 'object') p.push('Settings are missing.');
    else if (!isCents(d.settings.beginningBalance)) p.push('Beginning balance is not a whole number of cents.');
    ['expenseAccounts', 'incomeAccounts', 'payees', 'transactions', 'reconciliations'].forEach(function (k) {
      if (!Array.isArray(d[k])) p.push('"' + k + '" list is missing.');
    });

    var recIds = {};
    (Array.isArray(d.reconciliations) ? d.reconciliations : []).forEach(function (r, i) {
      var label = 'Reconciliation ' + (i + 1);
      if (!r || typeof r !== 'object') { p.push(label + ' is not valid.'); return; }
      if (!r.id) p.push(label + ' has no id.');
      else if (recIds[r.id]) p.push(label + ' has a duplicate id.');
      recIds[r.id] = true;
      if (!CB.util.isIsoDate(r.statementDate)) p.push(label + ' has a bad statement date.');
      if (!isCents(r.openingBalance) || !isCents(r.endingBalance)) p.push(label + ' has a balance that is not a whole number of cents.');
      if (!Array.isArray(r.transactionIds)) p.push(label + ' has no transaction list.');
    });
    var dr = d.reconcileDraft;
    if (dr != null && (typeof dr !== 'object' || !CB.util.isIsoDate(dr.statementDate) || !isCents(dr.endingBalance) || !Array.isArray(dr.tickedIds))) {
      p.push('The unfinished reconciliation is not valid.');
    }
    if (!Array.isArray(d.transactions)) return p;

    var ids = {};
    d.transactions.forEach(function (t, i) {
      var label = 'Transaction ' + (i + 1) + (t && t.payee ? ' (' + t.payee + ')' : '');
      if (!t || typeof t !== 'object') { p.push(label + ' is not valid.'); return; }
      if (!t.id) p.push(label + ' has no id.');
      else if (ids[t.id]) p.push(label + ' has a duplicate id.');
      ids[t.id] = true;
      if (KINDS.indexOf(t.kind) === -1) p.push(label + ' has an unknown kind "' + t.kind + '".');
      if (!CB.util.isIsoDate(t.date)) p.push(label + ' has a bad date.');
      if (!isCents(t.amount) || t.amount <= 0) p.push(label + ' has a bad amount.');
      if (t.reconciledId != null && !recIds[t.reconciledId]) p.push(label + ' is marked reconciled by a reconciliation that does not exist.');
      if (t.voidedAt != null) {
        if (typeof t.voidedAt !== 'string' || isNaN(new Date(t.voidedAt).getTime())) p.push(label + ' has a bad void date.');
        if (t.kind !== 'payment' || t.type !== 'Check') p.push(label + ' is voided but is not a check.');
        if (t.reconciledId != null) p.push(label + ' is both voided and reconciled.');
      }
      if (!Array.isArray(t.splits) || !t.splits.length) { p.push(label + ' has no account lines.'); return; }
      var sum = 0, splitsOk = true;
      t.splits.forEach(function (s) {
        if (!s || !isCents(s.amount) || s.amount <= 0) splitsOk = false; else sum += s.amount;
      });
      if (!splitsOk) p.push(label + ' has an account line with a bad amount.');
      else if (isCents(t.amount) && sum !== t.amount) p.push(label + ': account lines add up to ' + sum + ' cents but the total is ' + t.amount + '.');
    });
    return p;
  }

  // Damage the screens cannot even draw (they would crash and leave the register blank).
  // Returns a short description of the first such problem, or null. Call it AFTER migrate().
  // Everything else validate() finds is shown as a warning instead.
  function isObj(x) { return !!x && typeof x === 'object'; }
  function findDamage(d) {
    if (!isObj(d) || !isObj(d.settings)) return 'the settings are missing';
    var lists = ['expenseAccounts', 'incomeAccounts', 'payees', 'transactions'];
    for (var k = 0; k < lists.length; k++) {
      if (!Array.isArray(d[lists[k]])) return 'the "' + lists[k] + '" list is missing';
    }
    var i, j, t;
    // account and payee names are compared as text everywhere (adding, renaming, finding a payee)
    for (k = 0; k < 2; k++) {
      for (i = 0; i < d[lists[k]].length; i++) {
        if (typeof d[lists[k]][i] !== 'string') return 'entry ' + (i + 1) + ' in the "' + lists[k] + '" list is not a name';
      }
    }
    for (i = 0; i < d.payees.length; i++) {
      if (!isObj(d.payees[i])) return 'payee ' + (i + 1) + ' cannot be read';
      if (typeof d.payees[i].name !== 'string') return 'payee ' + (i + 1) + ' has no name';
    }
    for (i = 0; i < d.transactions.length; i++) {
      t = d.transactions[i];
      if (!isObj(t)) return 'transaction ' + (i + 1) + ' cannot be read';
      if (!Array.isArray(t.splits)) return 'transaction ' + (i + 1) + ' has no account lines';
      for (j = 0; j < t.splits.length; j++) if (!isObj(t.splits[j])) return 'transaction ' + (i + 1) + ' has an account line that cannot be read';
    }
    if (Array.isArray(d.reconciliations)) {
      for (i = 0; i < d.reconciliations.length; i++) if (!isObj(d.reconciliations[i])) return 'reconciliation ' + (i + 1) + ' cannot be read';
    }
    return null;
  }

  // Quick shape check (enough to recognise a CheckBook file at all)
  function looksLikeBook(d) {
    return !!(d && typeof d === 'object' && d.settings && Array.isArray(d.transactions));
  }

  return { VERSION: VERSION, blankBook: blankBook, sampleBook: sampleBook, migrate: migrate,
    validate: validate, looksLikeBook: looksLikeBook, findDamage: findDamage };
})();
