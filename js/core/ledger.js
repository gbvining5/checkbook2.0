/* =========================================================
   CB.ledger — calculations on a book. PURE FUNCTIONS:
   they take a book and return answers. They never change the
   book, touch the screen, or save anything. Easy to test.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.ledger = (function () {
  'use strict';

  // + for deposits, - for payments
  function signed(t) { return t.kind === 'deposit' ? t.amount : -t.amount; }

  // Register order: by date, then by the order entered
  function sorted(book) {
    return book.transactions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.seq || 0) - (b.seq || 0);
    });
  }

  function balances(book) {
    var bal = book.settings.beginningBalance, cleared = book.settings.beginningBalance;
    book.transactions.forEach(function (t) {
      bal += signed(t);
      if (t.cleared) cleared += signed(t);
    });
    return { current: bal, cleared: cleared };
  }

  // [{ t, balance }] in register order, with the running balance after each
  function withRunningBalance(book) {
    var bal = book.settings.beginningBalance;
    return sorted(book).map(function (t) { bal += signed(t); return { t: t, balance: bal }; });
  }

  function nextSeq(book) {
    return book.transactions.reduce(function (m, t) { return Math.max(m, t.seq || 0); }, 0) + 1;
  }

  function nextCheckNumber(book) {
    var max = 0;
    book.transactions.forEach(function (t) {
      if (t.kind === 'payment' && t.type === 'Check') {
        var n = parseInt(t.number, 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return String(max + 1);
  }

  // Check numbers are compared as numbers when they are all digits, so "0101" and "101" are the same check
  function checkNumberKey(n) {
    var s = String(n == null ? '' : n).trim();
    return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
  }

  function isDuplicateCheckNumber(book, number, exceptId) {
    var key = checkNumberKey(number);
    return book.transactions.some(function (t) {
      return t.kind === 'payment' && t.type === 'Check' && checkNumberKey(t.number) === key && t.id !== exceptId;
    });
  }

  function accountLabel(t) {
    if (!t.splits || !t.splits.length) return '';
    if (t.splits.length === 1) return t.splits[0].account;
    return '-- Split (' + t.splits.length + ') --';
  }

  function numberLabel(t) {
    if (t.number) return t.number;
    if (t.kind === 'deposit') return 'DEP';
    return { 'Debit Card': 'DEBIT', 'Electronic (ACH)': 'EFT', 'Bank Fee': 'FEE' }[t.type] || '';
  }

  function findPayee(book, name) {
    var n = String(name || '').trim().toLowerCase();
    for (var i = 0; i < book.payees.length; i++) if (book.payees[i].name.toLowerCase() === n) return book.payees[i];
    return null;
  }

  // A new transaction ready to push onto book.transactions (not cleared, not reconciled).
  // Used by Write Check / Make Deposit AND by Reconcile's "missing item", so new entries always have the same shape.
  // f: { kind, type, number, date, payee, amount, memo, splits }
  function newTxn(book, f) {
    return { id: CB.util.uid(), seq: nextSeq(book), kind: f.kind, type: f.type, number: f.number, date: f.date, payee: f.payee,
      amount: f.amount, memo: f.memo, cleared: false, reconciledId: null, splits: f.splits };
  }

  function getTxn(book, id) {
    for (var i = 0; i < book.transactions.length; i++) if (book.transactions[i].id === id) return book.transactions[i];
    return null;
  }

  // The checks a new or edited transaction must pass before it is recorded.
  // Used by Write Check / Make Deposit AND by Reconcile's "missing item", so the rules are the same.
  // f: { kind, type, number, date, payee, amount (cents or NaN), splits: [{ account, amount, memo, payee }], editingId }
  // Returns [{ field: 'date'|'payee'|'amount'|'account'|'number'|null, split: line index or null, message }] ([] = OK).
  function checkTxn(book, f) {
    var errs = [];
    function bad(field, message, split) { errs.push({ field: field, split: split == null ? null : split, message: message }); }
    function posCents(n) { return CB.money.isCents(n) && n > 0; }

    if (!f.date) bad('date', 'Enter a date.');
    else if (!CB.util.isIsoDate(f.date)) bad('date', 'That date is not a real date.');
    if (!f.payee) bad('payee', f.kind === 'payment' ? 'Enter who you paid.' : 'Enter who the money was received from.');
    if (!posCents(f.amount)) bad('amount', 'Enter an amount greater than zero.');

    var splits = f.splits || [];
    if (!splits.length) bad('account', 'Choose an account.');
    splits.forEach(function (s, i) {
      if (!s.account) bad('account', 'Choose an account on every line.', i);
      if (!posCents(s.amount)) bad('amount', 'Every account line needs an amount.', i);
    });
    if (posCents(f.amount) && splits.length) {
      var sum = splits.reduce(function (t, s) { return t + (isFinite(s.amount) ? s.amount : 0); }, 0);
      if (sum !== f.amount) bad(null, 'The account lines add up to ' + CB.money.format(sum) + ' but the total is ' + CB.money.format(f.amount) + '.');
    }
    if (f.kind === 'payment' && f.type === 'Check' && f.number && isDuplicateCheckNumber(book, f.number, f.editingId)) {
      bad('number', 'Check #' + f.number + ' is already in the register.');
    }
    return errs;
  }

  // Text used by the Find box
  function searchText(t) {
    return [t.payee, t.memo, t.number, t.type, CB.util.fmtDate(t.date), CB.money.plain(t.amount)]
      .concat((t.splits || []).map(function (s) { return s.account + ' ' + s.memo; }))
      .join(' ').toLowerCase();
  }

  return { signed: signed, sorted: sorted, balances: balances, withRunningBalance: withRunningBalance,
    nextSeq: nextSeq, nextCheckNumber: nextCheckNumber, isDuplicateCheckNumber: isDuplicateCheckNumber, newTxn: newTxn,
    accountLabel: accountLabel, numberLabel: numberLabel, findPayee: findPayee, getTxn: getTxn, searchText: searchText,
    checkTxn: checkTxn };
})();
