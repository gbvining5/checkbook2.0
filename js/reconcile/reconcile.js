/* =========================================================
   CB.reconcileUI — the Reconcile window (screen code only).
   The math lives in js/core/reconcile.js (CB.reconcile).

   Step 1: statement date + ending balance (opening balance is filled in).
   Step 2: tick what is on the statement until the difference is $0.00.
   Nothing in the book changes until Finish — except "Add Missing Item",
   which records a normal new transaction (and ticks it).
   Ticks live in memory until Finish, or until "Leave Unfinished"
   saves them in book.reconcileDraft.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.reconcileUI = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$, esc = CB.util.esc, fmtDate = CB.util.fmtDate;
  var M = CB.money, L = CB.ledger, R = CB.reconcile;

  var bookRef = null;   // the book this session belongs to (a new/opened book starts a new session)
  var session = null;   // { statementDate, endingBalance, tickedIds } — tickedIds is null until Step 2 is reached
  var initial = null;   // the session as it was when the window opened (Cancel / Discard go back to this)
  var step = 1;
  var showLater = false;

  function copy(s) {
    return { statementDate: s.statementDate, endingBalance: s.endingBalance, tickedIds: s.tickedIds ? s.tickedIds.slice() : null };
  }

  // Load the saved unfinished session if there is one, otherwise start fresh
  function startSession() {
    var book = CB.app.book;
    bookRef = book;
    var resumed = R.resume(book);
    session = resumed || { statementDate: '', endingBalance: null, tickedIds: null };
    initial = copy(session);
    step = resumed ? 2 : 1;
    showLater = false;
    hideMissing();
    fillStart();
  }

  // Unsaved work that ✕ would lose?
  function hasUnsavedWork() { return !!session && session.tickedIds !== null && !R.sameSession(session, initial); }

  function closeWindow() { if (window.Desktop) Desktop.close('reconcile'); }

  /* ---------- drawing ---------- */
  function fillStart() {
    $('#rc-date').value = session.statementDate || '';
    $('#rc-ending').value = session.endingBalance != null ? M.plain(session.endingBalance) : '';
  }

  function render() {
    if (!CB.app.book) return;
    if (bookRef !== CB.app.book) startSession();
    var book = CB.app.book;
    // a ticked item may have been deleted or changed in the CheckBook window meanwhile
    if (session.tickedIds) session.tickedIds = R.cleanTicks(book, session.tickedIds);

    var last = R.lastReconciliation(book);
    $('#rc-opening').value = M.format(R.openingBalance(book));
    $('#rc-last').textContent = last
      ? 'Last reconciled statement: ' + fmtDate(last.statementDate) + ', ending balance ' + M.format(last.endingBalance) + '.'
      : 'First reconciliation: the opening balance is the checkbook’s beginning balance.';
    $('#rc-draft-note').hidden = !book.reconcileDraft;
    $('#rc-startover').hidden = !book.reconcileDraft;
    $('#rc-step1').hidden = step !== 1;
    $('#rc-step2').hidden = step !== 2;
    if (step === 2) renderTick();
  }

  function listHtml(items, ticked, statementDate) {
    if (!items.length) return '<tr class="rc-empty"><td colspan="5">None</td></tr>';
    return items.map(function (t) {
      var later = t.date > statementDate;
      return '<tr data-id="' + esc(t.id) + '" class="' + (ticked[t.id] ? 'ticked' : '') + (later ? ' later' : '') + '">' +
        '<td><input type="checkbox" class="rc-tick"' + (ticked[t.id] ? ' checked' : '') + ' aria-label="On the statement"></td>' +
        '<td>' + esc(fmtDate(t.date)) + (later ? ' <span class="rc-later-tag" title="After the statement date">later</span>' : '') + '</td>' +
        '<td>' + esc(L.numberLabel(t)) + '</td>' +
        '<td title="' + esc(t.payee) + '">' + esc(t.payee) + '</td>' +
        '<td class="num">' + M.format(t.amount) + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderTick() {
    var book = CB.app.book;
    var ticked = {};
    session.tickedIds.forEach(function (id) { ticked[id] = true; });
    var list = R.candidates(book, session, showLater);
    var pays = list.filter(function (t) { return t.kind === 'payment'; });
    var deps = list.filter(function (t) { return t.kind === 'deposit'; });
    function count(a) { return a.filter(function (t) { return ticked[t.id]; }).length + ' of ' + a.length + ' ticked'; }

    $('#rc-stmt-info').textContent = 'Statement ending ' + fmtDate(session.statementDate);
    $('#rc-later').checked = showLater;
    $('#rc-pay tbody').innerHTML = listHtml(pays, ticked, session.statementDate);
    $('#rc-dep tbody').innerHTML = listHtml(deps, ticked, session.statementDate);
    $('#rc-pay-count').textContent = count(pays);
    $('#rc-dep-count').textContent = count(deps);

    var cleared = R.clearedTotal(book, session.tickedIds);
    var diff = session.endingBalance - cleared;
    $('#rc-t-open').textContent = M.format(R.openingBalance(book));
    $('#rc-t-stmt').textContent = M.format(session.endingBalance);
    $('#rc-t-cleared').textContent = M.format(cleared);
    var d = $('#rc-t-diff');
    d.textContent = M.format(diff);
    d.className = diff === 0 ? 'rc-ok' : 'rc-bad';
    var can = R.canFinish(book, session);
    $('#rc-finish').disabled = !can.ok;
    $('#rc-finish').title = can.ok ? 'Lock the ticked items as reconciled' : can.reason;
  }

  /* ---------- actions ---------- */
  function showErrors(list) {
    CB.dialog('Please Fix', '<ul><li>' + list.filter(function (m, i) { return list.indexOf(m) === i; }).map(esc).join('</li><li>') + '</li></ul>');
  }

  function next() {
    var date = $('#rc-date').value;
    var ending = M.toCents($('#rc-ending').value);
    var errs = R.checkStart(CB.app.book, date, ending);
    if (errs.length) { showErrors(errs); return; }
    session.statementDate = date;
    session.endingBalance = ending;
    if (!session.tickedIds) session.tickedIds = R.initialTicks(CB.app.book, date);
    step = 2;
    render();
  }

  function back() { fillStart(); step = 1; hideMissing(); render(); }

  function setTicks(ids, on) {
    var set = {};
    session.tickedIds.forEach(function (id) { set[id] = true; });
    ids.forEach(function (id) { if (on) set[id] = true; else delete set[id]; });
    // keep the existing order, then any new ids
    var out = session.tickedIds.filter(function (id) { return set[id]; });
    ids.forEach(function (id) { if (set[id] && out.indexOf(id) === -1) out.push(id); });
    session.tickedIds = out;
    renderTick();
  }

  function markAll(kind, on) {
    var ids = R.candidates(CB.app.book, session, showLater)
      .filter(function (t) { return t.kind === kind; })
      .map(function (t) { return t.id; });
    setTicks(ids, on);
  }

  function finish() {
    var book = CB.app.book;
    var can = R.canFinish(book, session);
    if (!can.ok) { CB.dialog('Reconcile', esc(can.reason)); return; }
    var rec = R.finish(book, session, CB.util.uid(), new Date().toISOString());
    closeWindow();
    startSession();
    CB.app.commit('Reconciled ' + rec.transactionIds.length + ' transaction' + (rec.transactionIds.length === 1 ? '' : 's') +
      ' through ' + fmtDate(rec.statementDate) + '.');
  }

  function leaveUnfinished() {
    CB.app.book.reconcileDraft = R.makeDraft(session);
    closeWindow();
    startSession();   // picks the saved draft back up
    CB.app.commit('Reconciliation saved as unfinished. Click Reconcile to come back to it.');
  }

  // Throw away this session's changes; back to how it was when the window opened. Saves nothing.
  function cancel() {
    closeWindow();
    startSession();
    render();
    CB.status('Reconcile cancelled. Ticks from this session were discarded.');
  }

  function startOver() {
    var d = CB.app.book.reconcileDraft;
    if (!d) return;
    CB.dialog('Start Over',
      'Throw away the saved unfinished reconciliation' +
      (CB.util.isIsoDate(d.statementDate) ? ' for the statement ending <b>' + esc(fmtDate(d.statementDate)) + '</b>' : '') +
      '?<br><br>Its ticks will be lost. No transactions are changed.',
      [{ label: 'Start Over', value: true, primary: true }, { label: 'Cancel', value: false }]
    ).then(function (ok) {
      if (!ok) return;
      CB.app.book.reconcileDraft = null;
      startSession();
      CB.app.commit('Saved unfinished reconciliation discarded.');
    });
  }

  // ✕ with unsaved ticks: ask instead of losing them
  function onCloseClick(e) {
    if (!e.target.closest('.titlebar .cap-close') || !hasUnsavedWork()) return;
    e.preventDefault();
    e.stopPropagation();   // capture phase: stops the window manager from closing it
    CB.dialog('Close Reconcile',
      'You have ticked items that are not saved yet.<br><br>' +
      '<b>Leave Unfinished</b> keeps your ticks so you can come back later.<br>' +
      '<b>Discard</b> throws away this session’s ticks. No transactions are changed.',
      [{ label: 'Leave Unfinished', value: 'leave', primary: true }, { label: 'Discard', value: 'discard' }, { label: 'Cancel', value: null }]
    ).then(function (v) {
      if (v === 'leave') leaveUnfinished();
      else if (v === 'discard') cancel();
    });
  }

  /* ---------- missing item (bank fee, interest, ...) ---------- */
  var KINDS = {
    fee:      { kind: 'payment', type: 'Bank Fee', account: 'Bank Fees' },
    interest: { kind: 'deposit', type: 'Deposit',  account: 'Interest' },
    payment:  { kind: 'payment', type: 'Other',    account: '' },
    deposit:  { kind: 'deposit', type: 'Deposit',  account: '' }
  };

  function fillMissingAccounts() {
    var k = KINDS[$('#rc-m-kind').value];
    var book = CB.app.book;
    var list = k.kind === 'payment' ? book.expenseAccounts : book.incomeAccounts;
    $('#rc-m-account').innerHTML = '<option value="">(choose)</option>' +
      list.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('');
    $('#rc-m-account').value = list.indexOf(k.account) !== -1 ? k.account : '';
    $('#rc-m-payee-label').textContent = k.kind === 'payment' ? 'Paid to' : 'Received from';
  }

  function clearMissingInvalid() { $$('#rc-missing .invalid').forEach(function (el) { el.classList.remove('invalid'); }); }

  function showMissing() {
    $('#rc-m-kind').value = 'fee';
    $('#rc-m-date').value = session.statementDate;
    $('#rc-m-payee').value = '';
    $('#rc-m-amount').value = '';
    $('#rc-m-memo').value = '';
    fillMissingAccounts();
    clearMissingInvalid();
    $('#rc-missing').hidden = false;
    $('#rc-add').disabled = true;
    if ($('#rc-missing').scrollIntoView) $('#rc-missing').scrollIntoView({ block: 'nearest' });
    $('#rc-m-payee').focus();
  }

  function hideMissing() {
    var box = $('#rc-missing');
    if (box) box.hidden = true;
    var add = $('#rc-add');
    if (add) add.disabled = false;
  }

  function addMissing() {
    var book = CB.app.book;
    var k = KINDS[$('#rc-m-kind').value];
    var date = $('#rc-m-date').value;
    var payee = $('#rc-m-payee').value.trim();
    var amount = M.toCents($('#rc-m-amount').value);
    var memo = $('#rc-m-memo').value.trim();
    var splits = [{ account: $('#rc-m-account').value, amount: amount, memo: memo, payee: payee }];

    clearMissingInvalid();
    var errs = L.checkTxn(book, { kind: k.kind, type: k.type, number: '', date: date, payee: payee, amount: amount,
      splits: splits, editingId: null });
    if (errs.length) {
      var el = { date: '#rc-m-date', payee: '#rc-m-payee', amount: '#rc-m-amount', account: '#rc-m-account' };
      errs.forEach(function (e) { if (el[e.field]) $(el[e.field]).classList.add('invalid'); });
      showErrors(errs.map(function (e) { return e.message; }));
      return false;
    }

    CB.lists.ensurePayee(payee);
    var txn = { id: CB.util.uid(), seq: L.nextSeq(book), kind: k.kind, type: k.type, number: '', date: date, payee: payee,
      amount: amount, memo: memo, cleared: false, reconciledId: null, splits: splits };
    book.transactions.push(txn);
    session.tickedIds.push(txn.id);   // arrives already ticked
    hideMissing();
    CB.app.commit((k.kind === 'payment' ? k.type + ' ' : 'Deposit ') + M.format(amount) + ' added and ticked.');
    return true;
  }

  /* ---------- wiring ---------- */
  function open() {
    render();
    if (window.Desktop) Desktop.open('reconcile');
    var first = step === 1 ? $('#rc-date') : null;
    if (first) first.focus();
  }

  function init() {
    var win = $('#win-reconcile');
    win.addEventListener('click', onCloseClick, true);

    $('#rc-next').addEventListener('click', next);
    $('#rc-back').addEventListener('click', back);
    $('#rc-finish').addEventListener('click', finish);
    $('#rc-leave').addEventListener('click', leaveUnfinished);
    $('#rc-startover').addEventListener('click', startOver);
    $$('.js-rc-cancel', win).forEach(function (b) { b.addEventListener('click', cancel); });
    $('#rc-later').addEventListener('change', function () { showLater = this.checked; renderTick(); });
    $$('[data-mark]', win).forEach(function (b) {
      b.addEventListener('click', function () { markAll(b.dataset.mark, b.dataset.on === '1'); });
    });

    // tick / untick: click the box or anywhere on the row
    $$('.rc-table', win).forEach(function (table) {
      table.addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        var on = e.target.classList.contains('rc-tick') ? e.target.checked : !tr.classList.contains('ticked');
        setTicks([tr.dataset.id], on);
      });
    });

    $('#rc-add').addEventListener('click', showMissing);
    $('#rc-m-kind').addEventListener('change', fillMissingAccounts);
    $('#rc-m-add').addEventListener('click', addMissing);
    $('#rc-m-cancel').addEventListener('click', hideMissing);
  }

  return { init: init, open: open, render: render };
})();
