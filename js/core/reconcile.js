/* =========================================================
   CB.reconcile — the math for balancing the register against a
   bank statement. No screen code. Money is always whole cents and
   is only ever compared as exact integers.

   A "session" is what the user is working on:
     { statementDate: 'YYYY-MM-DD', endingBalance: cents, tickedIds: [transaction id] }
   (the same shape as book.reconcileDraft, which is a saved session).

   Everything here is a pure function EXCEPT finish(), which applies a
   finished reconciliation to the book it is given. Nothing here saves;
   the screen calls CB.app.commit() afterwards.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.reconcile = (function () {
  'use strict';
  var L = CB.ledger;

  function isCents(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function isReconciled(t) { return t.reconciledId != null; }

  function lastReconciliation(book) {
    var r = book.reconciliations || [];
    return r.length ? r[r.length - 1] : null;
  }

  // Where this statement starts: the last statement's ending balance,
  // or the checkbook's beginning balance the first time.
  function openingBalance(book) {
    var last = lastReconciliation(book);
    return last ? last.endingBalance : book.settings.beginningBalance;
  }

  // Not-yet-reconciled transactions, in register order
  function unreconciled(book) {
    return L.sorted(book).filter(function (t) { return !isReconciled(t); });
  }

  // Keep only ids of transactions that still exist and are not reconciled (no duplicates)
  function cleanTicks(book, ids) {
    var open = {}, seen = {};
    unreconciled(book).forEach(function (t) { open[t.id] = true; });
    return (ids || []).filter(function (id) {
      if (!open[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  // Items already marked cleared in the register start out ticked
  function initialTicks(book, statementDate) {
    return unreconciled(book)
      .filter(function (t) { return t.cleared && t.date <= statementDate; })
      .map(function (t) { return t.id; });
  }

  // What to list: unreconciled items on or before the statement date
  // (or all of them with showLater). Ticked items are always listed.
  function candidates(book, session, showLater) {
    var ticked = {};
    (session.tickedIds || []).forEach(function (id) { ticked[id] = true; });
    return unreconciled(book).filter(function (t) {
      return showLater || t.date <= session.statementDate || ticked[t.id];
    });
  }

  // Opening balance + every ticked item (deposits add, payments subtract)
  function clearedTotal(book, tickedIds) {
    var total = openingBalance(book);
    cleanTicks(book, tickedIds).forEach(function (id) { total += L.signed(L.getTxn(book, id)); });
    return total;
  }

  // Statement balance minus cleared total. 0 means it balances.
  function difference(book, session) {
    return session.endingBalance - clearedTotal(book, session.tickedIds);
  }

  // Step 1 checks. Returns a list of plain-English problems ([] = OK).
  function checkStart(book, statementDate, endingBalance) {
    var p = [];
    var last = lastReconciliation(book);
    if (!CB.util.isIsoDate(statementDate)) p.push('Enter the statement ending date.');
    else if (last && statementDate < last.statementDate) {
      p.push('The statement date can’t be before the last reconciled statement (' + CB.util.fmtDate(last.statementDate) + ').');
    }
    if (!isCents(endingBalance)) p.push('Enter the statement ending balance.');
    return p;
  }

  // -> { ok: true } or { ok: false, reason }
  function canFinish(book, session) {
    if (!session || !Array.isArray(session.tickedIds)) return { ok: false, reason: 'Nothing to finish.' };
    var p = checkStart(book, session.statementDate, session.endingBalance);
    if (p.length) return { ok: false, reason: p[0] };
    var diff = difference(book, session);
    if (!isCents(diff) || diff !== 0) {
      return { ok: false, reason: 'The difference must be exactly ' + CB.money.format(0) + ' to finish. It is now ' + CB.money.format(diff) + '.' };
    }
    return { ok: true };
  }

  // Lock the ticked items as reconciled and record the statement.
  // CHANGES the book. Throws (and changes nothing) unless canFinish() is ok.
  function finish(book, session, id, finishedAt) {
    var check = canFinish(book, session);
    if (!check.ok) throw new Error(check.reason);
    var ids = cleanTicks(book, session.tickedIds);
    var rec = {
      id: id,
      statementDate: session.statementDate,
      openingBalance: openingBalance(book),     // read BEFORE adding this record
      endingBalance: session.endingBalance,
      transactionIds: ids,
      finishedAt: finishedAt
    };
    ids.forEach(function (tid) {
      var t = L.getTxn(book, tid);
      t.cleared = true;          // reconciled items have, by definition, cleared the bank
      t.reconciledId = id;
    });
    book.reconciliations.push(rec);
    book.reconcileDraft = null;
    return rec;
  }

  // "Leave unfinished": the draft to store in book.reconcileDraft
  function makeDraft(session) {
    return { statementDate: session.statementDate, endingBalance: session.endingBalance, tickedIds: session.tickedIds.slice() };
  }

  // Coming back to a saved draft -> session (ticks cleaned), or null if there is none / it is unusable
  function resume(book) {
    var d = book.reconcileDraft;
    if (!d || typeof d !== 'object' || !CB.util.isIsoDate(d.statementDate) || !isCents(d.endingBalance) || !Array.isArray(d.tickedIds)) return null;
    return { statementDate: d.statementDate, endingBalance: d.endingBalance, tickedIds: cleanTicks(book, d.tickedIds) };
  }

  // Are two sessions the same (ticks compared as sets)?
  function sameSession(a, b) {
    if (!a || !b) return a === b;
    if (a.statementDate !== b.statementDate || a.endingBalance !== b.endingBalance) return false;
    if (!a.tickedIds || !b.tickedIds) return a.tickedIds === b.tickedIds;
    return a.tickedIds.slice().sort().join('\n') === b.tickedIds.slice().sort().join('\n');
  }

  return { isReconciled: isReconciled, lastReconciliation: lastReconciliation, openingBalance: openingBalance,
    cleanTicks: cleanTicks, initialTicks: initialTicks, candidates: candidates, clearedTotal: clearedTotal,
    difference: difference, checkStart: checkStart, canFinish: canFinish, finish: finish,
    makeDraft: makeDraft, resume: resume, sameSession: sameSession };
})();
