/* =========================================================
   CB.reconcile — the math for balancing the register against a
   bank statement. No screen code. Money is always whole cents and
   is only ever compared as exact integers.

   A "session" is what the user is working on:
     { statementDate: 'YYYY-MM-DD', endingBalance: cents, tickedIds: [transaction id] }
   (the same shape as book.reconcileDraft, which is a saved session).

   Everything here is a pure function EXCEPT finish() and undoLast(), which
   change the book they are given. Nothing here saves;
   the screen calls CB.app.commit() afterwards.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.reconcile = (function () {
  'use strict';
  var L = CB.ledger;

  var isCents = CB.money.isCents;
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

  // Not-yet-reconciled transactions, in register order. Voided checks are left out:
  // they count as $0.00, so there is nothing to tick (and they can't be reconciled).
  function unreconciled(book) {
    return L.sorted(book).filter(function (t) { return !isReconciled(t) && !L.isVoided(t); });
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

  /* ---------- Part 2: help when it doesn't balance (pure) ---------- */
  var MAX_HINT_ITEMS = 3;

  function tickSet(book, session) {
    var set = {};
    cleanTicks(book, session.tickedIds).forEach(function (id) { set[id] = true; });
    return set;
  }

  // Unticked items that would make the difference exactly 0 if ticked.
  // (Ticking t changes the difference by -signed(t), so we need signed(t) === difference.)
  function hintUnticked(book, session) {
    var diff = difference(book, session);
    if (diff === 0) return [];
    var ticked = tickSet(book, session);
    return unreconciled(book).filter(function (t) { return !ticked[t.id] && L.signed(t) === diff; });
  }

  // Ticked items that would make the difference exactly 0 if they were the other kind
  // (a payment entered as a deposit, or the reverse, is off by twice its amount).
  function hintReversed(book, session) {
    var diff = difference(book, session);
    if (diff === 0) return [];
    var ticked = tickSet(book, session);
    return unreconciled(book).filter(function (t) { return ticked[t.id] && -2 * L.signed(t) === diff; });
  }

  // Voided checks that would make the difference exactly 0 if they were not void and ticked
  // (the bank paid a check that was voided here). Checks are payments, so that is -amount === difference.
  function hintVoided(book, session) {
    var diff = difference(book, session);
    if (diff === 0) return [];
    return L.sorted(book).filter(function (t) { return L.isVoided(t) && !isReconciled(t) && L.isCheck(t) && -t.amount === diff; });
  }

  // Swapped digits (45 vs 54) always make a difference that divides evenly by 9.
  // Weak signal: about 1 in 9 unrelated differences also divide by 9.
  function hintTransposed(diff) {
    return isCents(diff) && diff !== 0 && Math.abs(diff) % 9 === 0;
  }

  function itemLabel(t) { return t.payee + ', ' + CB.money.format(t.amount) + ' (' + CB.util.fmtDate(t.date) + ')'; }

  // Plain-text hints to show under the totals ([] when it balances). The screen escapes them.
  function hints(book, session) {
    var diff = difference(book, session);
    if (!isCents(diff) || diff === 0) return [];
    var out = [];
    hintUnticked(book, session).slice(0, MAX_HINT_ITEMS).forEach(function (t) {
      out.push({ rule: 'unticked', id: t.id, text: 'Did ' + itemLabel(t) + ' clear?' +
        (t.date > session.statementDate ? ' (It is dated after the statement; tick “Show later dates too” to see it.)' : '') });
    });
    hintReversed(book, session).slice(0, MAX_HINT_ITEMS).forEach(function (t) {
      out.push({ rule: 'reversed', id: t.id, text: 'Check that ' + itemLabel(t) + ' isn’t entered as a ' +
        (t.kind === 'deposit' ? 'deposit instead of a payment.' : 'payment instead of a deposit.') });
    });
    hintVoided(book, session).slice(0, MAX_HINT_ITEMS).forEach(function (t) {
      out.push({ rule: 'voided', id: t.id, text: L.checkLabel(t) + ' to ' + itemLabel(t) + ' is void. If the bank paid it, ' +
        'it was voided by mistake: click it in the register and Unvoid it.' });
    });
    if (hintTransposed(diff)) out.push({ rule: 'transposed', id: null, text: 'Two digits may be swapped (like 45 vs 54).' });
    return out;
  }

  /* ---------- Part 2: undo the most recent reconciliation ---------- */
  function findReconciliation(book, recId) {
    var r = book.reconciliations || [];
    for (var i = 0; i < r.length; i++) if (r[i].id === recId) return r[i];
    return null;
  }

  // -> { ok: true } or { ok: false, reason }. Only the most recent one, and not while one is unfinished.
  function canUndo(book, recId) {
    var last = lastReconciliation(book);
    if (!last) return { ok: false, reason: 'There is no reconciliation to undo.' };
    if (last.id !== recId) return { ok: false, reason: 'Only the most recent reconciliation can be undone.' };
    if (book.reconcileDraft) return { ok: false, reason: 'Finish or Start Over the unfinished reconciliation first.' };
    return { ok: true };
  }

  // Put the items back to cleared-but-not-reconciled and remove the record.
  // CHANGES the book. Throws (and changes nothing) unless canUndo() is ok.
  function undoLast(book, recId) {
    var check = canUndo(book, recId);
    if (!check.ok) throw new Error(check.reason);
    var rec = book.reconciliations.pop();
    book.transactions.forEach(function (t) {
      if (t.reconciledId === rec.id) { t.reconciledId = null; t.cleared = true; }
    });
    return rec;
  }

  /* ---------- Part 2: report (pure) ---------- */
  // Rebuilt from the book as it is now (no snapshot is stored), so it also reports
  // items deleted since and any amount by which it no longer adds up.
  function report(book, recId) {
    var recs = book.reconciliations || [];
    var rec = findReconciliation(book, recId);
    if (!rec) return null;
    var order = {};
    recs.forEach(function (r, i) { order[r.id] = i; });
    var idx = order[rec.id];
    var pay = { count: 0, total: 0 }, dep = { count: 0, total: 0 };
    var outstanding = [];
    L.sorted(book).forEach(function (t) {
      if (t.reconciledId === rec.id) {
        var g = t.kind === 'deposit' ? dep : pay;
        g.count++; g.total += L.amountOf(t);
      } else if (t.date <= rec.statementDate && !(t.reconciledId != null && order[t.reconciledId] < idx) && !L.isVoided(t)) {
        outstanding.push(t);   // not reconciled by this statement or an earlier one (voided checks are not outstanding)
      }
    });
    var deleted = (rec.transactionIds || []).filter(function (id) { return !L.getTxn(book, id); }).length;
    return {
      id: rec.id, statementDate: rec.statementDate, finishedAt: rec.finishedAt,
      openingBalance: rec.openingBalance, endingBalance: rec.endingBalance,
      payments: pay, deposits: dep, outstanding: outstanding,
      deletedCount: deleted,
      offBy: rec.endingBalance - (rec.openingBalance + dep.total - pay.total)   // 0 unless something changed since
    };
  }

  /* ---------- Part 2: protecting reconciled transactions (pure) ---------- */
  // Does saving these changes to t need the warning? Only amount, date and kind count.
  function changeNeedsWarning(t, changes) {
    if (!t || !isReconciled(t)) return false;
    return (changes.amount !== undefined && changes.amount !== t.amount) ||
           (changes.date !== undefined && changes.date !== t.date) ||
           (changes.kind !== undefined && changes.kind !== t.kind);
  }

  // ISO date-time -> local YYYY-MM-DD ('' if unreadable)
  function localDay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + CB.util.pad(d.getMonth() + 1) + '-' + CB.util.pad(d.getDate());
  }

  function whenText(rec) {
    var day = localDay(rec.finishedAt);
    var stmt = 'statement dated ' + CB.util.fmtDate(rec.statementDate);
    return day ? CB.util.fmtDate(day) + ' (' + stmt + ')' : 'the ' + stmt;
  }

  // Plain-text warning for changing/deleting a reconciled transaction (null if it isn't reconciled)
  function warningFor(book, t) {
    if (!t || !isReconciled(t)) return null;
    var rec = findReconciliation(book, t.reconciledId);
    return 'This was reconciled on ' + (rec ? whenText(rec) : 'an earlier statement') +
      '. Changing it will make that reconciliation wrong.';
  }

  // Plain-text warning for changing the beginning balance (null if nothing is reconciled yet).
  // The first reconciliation is the one whose opening balance came from the beginning balance.
  function beginningBalanceWarning(book) {
    var r = book.reconciliations || [];
    if (!r.length) return null;
    return 'This checkbook was reconciled on ' + whenText(r[0]) + '. Changing the beginning balance will make that reconciliation wrong.';
  }

  return { isReconciled: isReconciled, lastReconciliation: lastReconciliation, openingBalance: openingBalance,
    cleanTicks: cleanTicks, initialTicks: initialTicks, candidates: candidates, clearedTotal: clearedTotal,
    difference: difference, checkStart: checkStart, canFinish: canFinish, finish: finish,
    makeDraft: makeDraft, resume: resume, sameSession: sameSession,
    hintUnticked: hintUnticked, hintReversed: hintReversed, hintVoided: hintVoided, hintTransposed: hintTransposed, hints: hints,
    findReconciliation: findReconciliation, canUndo: canUndo, undoLast: undoLast, report: report,
    changeNeedsWarning: changeNeedsWarning, warningFor: warningFor, beginningBalanceWarning: beginningBalanceWarning };
})();
