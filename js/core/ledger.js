/* =========================================================
   CB.ledger — calculations on a book. PURE FUNCTIONS:
   they take a book and return answers. They never change the
   book, touch the screen, or save anything. Easy to test.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.ledger = (function () {
  'use strict';

  // A voided check stays in the register but counts as $0.00 (its own amount is kept for Unvoid)
  function isVoided(t) { return t.voidedAt != null; }
  function isCheck(t) { return t.kind === 'payment' && t.type === 'Check'; }

  // What a transaction counts for in balances, reports and reconciling: 0 when voided.
  // Use this (or signed), never t.amount, for money math.
  function amountOf(t) { return isVoided(t) ? 0 : t.amount; }

  // + for deposits, - for payments (0 when voided)
  function signed(t) { return t.kind === 'deposit' ? amountOf(t) : -amountOf(t); }

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
      amount: f.amount, memo: f.memo, cleared: false, reconciledId: null, voidedAt: null, splits: f.splits };
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

  /* ---------- void (checks only) ---------- */
  function checkLabel(t) { return t.number ? 'Check #' + t.number : 'This check'; }

  // Can t be voided? -> { ok: true, cleared: bool } or { ok: false, reason: plain text }
  // cleared: it is marked "c" (the bank paid it), so the screen must warn first.
  function canVoid(book, t) {
    if (!t) return { ok: false, reason: 'Click a check in the register first, then choose Void.' };
    if (!isCheck(t)) {
      return { ok: false, reason: 'Only checks can be voided. To remove ' + (t.kind === 'deposit' ? 'a deposit' : 'this ' + t.type + ' payment') + ', use Delete instead.' };
    }
    if (isVoided(t)) return { ok: false, reason: checkLabel(t) + ' is already void.' };
    if (t.reconciledId != null) {
      var recs = book.reconciliations || [], at = -1;
      for (var i = 0; i < recs.length; i++) if (recs[i].id === t.reconciledId) at = i;
      var newer = at === -1 ? 0 : recs.length - 1 - at;
      return { ok: false, reason: checkLabel(t) + ' is reconciled (R)' +
        (at === -1 ? '' : ' on the statement dated ' + CB.util.fmtDate(recs[at].statementDate)) + ', so it can’t be voided. ' +
        'Undo that reconciliation first (Reconcile window, Undo Last Reconciliation)' +
        (newer ? '. Only the most recent one can be undone, so undo the ' + (newer === 1 ? 'newer statement' : newer + ' newer statements') + ' first.' : '.') };
    }
    return { ok: true, cleared: !!t.cleared };
  }

  // -> { ok: true } or { ok: false, reason }
  function canUnvoid(book, t) {
    if (!t) return { ok: false, reason: 'Click a voided check in the register first, then choose Unvoid.' };
    if (!isVoided(t)) return { ok: false, reason: (isCheck(t) ? checkLabel(t) : 'This transaction') + ' is not void.' };
    return { ok: true };
  }

  // Plain-text warning for deleting a voided check (null if it isn't voided)
  function voidDeleteWarning(t) {
    if (!t || !isVoided(t)) return null;
    return checkLabel(t) + ' is void. Deleting it removes it from the register completely' +
      (t.number ? ' and frees number ' + t.number + ' so it could be used again' : '') +
      '. Usually you keep voided checks so every check number is accounted for.';
  }

  // Text used by the Find box
  function searchText(t) {
    return [t.payee, t.memo, t.number, t.type, CB.util.fmtDate(t.date), CB.money.plain(t.amount), isVoided(t) ? 'void' : '']
      .concat((t.splits || []).map(function (s) { return s.account + ' ' + s.memo; }))
      .join(' ').toLowerCase();
  }

  return { isVoided: isVoided, isCheck: isCheck, amountOf: amountOf, canVoid: canVoid, canUnvoid: canUnvoid,
    checkLabel: checkLabel, voidDeleteWarning: voidDeleteWarning,
    signed: signed, sorted: sorted, balances: balances, withRunningBalance: withRunningBalance,
    nextSeq: nextSeq, nextCheckNumber: nextCheckNumber, isDuplicateCheckNumber: isDuplicateCheckNumber, newTxn: newTxn,
    accountLabel: accountLabel, numberLabel: numberLabel, findPayee: findPayee, getTxn: getTxn, searchText: searchText,
    checkTxn: checkTxn };
})();
