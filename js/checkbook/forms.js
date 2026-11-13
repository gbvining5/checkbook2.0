/* =========================================================
   CB.forms — the Write Check and Make Deposit forms:
   fill, clear, validate, record, edit, delete, void / unvoid.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.forms = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$, esc = CB.util.esc;
  var M = CB.money, L = CB.ledger;
  var splitsP, splitsD;

  /* ---------- helpers ---------- */
  function payeeAddress(name) {
    var p = L.findPayee(CB.app.book, name);
    return p ? [p.address, p.city].filter(Boolean).join('\n') : '';
  }
  function updateWords(prefix) {
    var c = M.toCents($('#' + prefix + '-amount').value);
    $('#' + prefix + '-words').innerHTML = isFinite(c) && c > 0 ? esc(M.words(c)) : '&nbsp;';
  }
  function setEditMode(form, on) {
    $('.edit-banner', form).hidden = !on;
    $('.js-record', form).textContent = on ? 'Save Changes' : 'Record';
    $('.js-clear', form).textContent = on ? 'Cancel' : 'Clear';
  }
  // Local MM/DD/YYYY of an ISO date-time ('' if unreadable)
  function localDay(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return CB.util.fmtDate(d.getFullYear() + '-' + CB.util.pad(d.getMonth() + 1) + '-' + CB.util.pad(d.getDate()));
  }

  // Write Check form: a voided check is shown read-only (its kept amount can't drift) with an Unvoid button.
  // The Void / Unvoid button shows only while a stored check is open. t = the open transaction, or null.
  function setVoidView(t) {
    var f = $('#page-check');
    var voided = !!t && L.isVoided(t);
    f.classList.toggle('is-void', voided);
    $$('input, select, #p-splits button, #p-addsplit', f).forEach(function (el) { el.disabled = voided; });
    $('.js-record', f).hidden = voided;
    var day = voided ? localDay(t.voidedAt) : '';
    $('.edit-banner', f).textContent = voided ? 'VOID' + (day ? ' — voided on ' + day : '') + '. Unvoid it to make changes.' : 'Editing an existing transaction';
    var btn = $('#p-void');
    btn.hidden = !(t && L.isCheck(t));
    btn.textContent = voided ? 'Unvoid Check' : 'Void Check…';
  }

  function clearInvalid(form) { $$('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); }); }

  function updateNumberField() {
    var type = $('#p-type').value;
    var num = $('#p-number');
    var next = L.nextCheckNumber(CB.app.book);
    $('#p-num-label').textContent = type === 'Check' ? 'Check #' : 'Ref #';
    if (!CB.app.editing.payment) {
      if (type === 'Check') { if (!num.value) num.value = next; }
      else if (num.value === next) num.value = '';
    }
  }

  /* ---------- reset / load ---------- */
  function resetPayment() {
    CB.app.editing.payment = null;
    var f = $('#page-check');
    setVoidView(null);
    f.reset();
    $('#p-type').value = 'Check';
    $('#p-date').value = CB.util.today();
    $('#p-address').textContent = '';
    updateNumberField();
    updateWords('p');
    splitsP.reset();
    setEditMode(f, false);
    clearInvalid(f);
  }

  function resetDeposit() {
    CB.app.editing.deposit = null;
    var f = $('#page-deposit');
    f.reset();
    $('#d-date').value = CB.util.today();
    updateWords('d');
    splitsD.reset();
    setEditMode(f, false);
    clearInvalid(f);
  }

  function loadInto(t) {
    if (t.kind === 'payment') {
      CB.main.showTab('check');
      CB.app.editing.payment = t.id;
      $('#p-type').value = t.type;
      $('#p-number').value = t.number;
      $('#p-date').value = t.date;
      $('#p-payee').value = t.payee;
      $('#p-amount').value = M.plain(t.amount);
      $('#p-memo').value = t.memo;
      $('#p-address').textContent = payeeAddress(t.payee);
      updateNumberField();
      updateWords('p');
      splitsP.load(t.splits);
      setEditMode($('#page-check'), true);
      setVoidView(t);
      clearInvalid($('#page-check'));
    } else {
      CB.main.showTab('deposit');
      CB.app.editing.deposit = t.id;
      $('#d-number').value = t.number;
      $('#d-date').value = t.date;
      $('#d-payee').value = t.payee;
      $('#d-amount').value = M.plain(t.amount);
      $('#d-memo').value = t.memo;
      updateWords('d');
      splitsD.load(t.splits);
      setEditMode($('#page-deposit'), true);
      clearInvalid($('#page-deposit'));
    }
  }

  /* ---------- record (validate + save) ---------- */
  function record(kind) {
    var book = CB.app.book;
    var p = kind === 'payment' ? 'p' : 'd';
    var form = kind === 'payment' ? $('#page-check') : $('#page-deposit');
    var editor = kind === 'payment' ? splitsP : splitsD;
    clearInvalid(form);
    var errors = [];

    var date = $('#' + p + '-date').value;
    var payee = $('#' + p + '-payee').value.trim();
    var amount = M.toCents($('#' + p + '-amount').value);
    var memo = $('#' + p + '-memo').value.trim();
    var number = $('#' + p + '-number').value.trim();
    var type = kind === 'payment' ? $('#p-type').value : 'Deposit';

    editor.syncSingle();
    var all = editor.read();
    var rows = all.filter(function (r) {
      var blank = !r.account && !r.amountRaw && !r.memo && !r.payee;
      return !(blank && all.length > 1); // ignore empty extra lines
    });
    // A blank line memo/payee uses the transaction's own. When editing, a line memo/payee that just
    // repeats the transaction's OLD memo/payee follows the edit too (so renaming the payee updates its lines).
    var id = CB.app.editing[kind];
    var existing = id ? L.getTxn(book, id) : null;
    if (existing && L.isVoided(existing)) {
      CB.dialog('Void Check', esc(L.checkLabel(existing)) + ' is void. Unvoid it before changing it.');
      return false;
    }
    var splits = rows.map(function (r) {
      var lineMemo = r.memo && !(existing && r.memo === existing.memo) ? r.memo : memo;
      var linePayee = r.payee && !(existing && r.payee === existing.payee) ? r.payee : payee;
      return { account: r.account, amount: r.amount, memo: lineMemo, payee: linePayee };
    });

    // the checks themselves live in CB.ledger.checkTxn (shared with Reconcile); here we just highlight fields
    var fieldEl = { date: $('#' + p + '-date'), payee: $('#' + p + '-payee'), amount: $('#' + p + '-amount'), number: $('#p-number') };
    L.checkTxn(book, { kind: kind, type: type, number: number, date: date, payee: payee, amount: amount,
      splits: splits, editingId: CB.app.editing[kind] }).forEach(function (e) {
      var el = e.split != null ? $(e.field === 'account' ? '.sp-acct' : '.sp-amt', rows[e.split].row) : fieldEl[e.field];
      if (el) el.classList.add('invalid');
      errors.push(e.message);
    });

    if (errors.length) {
      CB.dialog.errors(errors);
      return false;
    }

    // amount, date or kind of a reconciled item: warn first (memo, payee and accounts are fine)
    if (existing && CB.reconcile.changeNeedsWarning(existing, { amount: amount, date: date, kind: kind })) {
      CB.dialog('Reconciled Transaction', esc(CB.reconcile.warningFor(book, existing)) + '<br><br>Save the change anyway?',
        [{ label: 'Save Anyway', value: true }, { label: 'Cancel', value: false, primary: true }]
      ).then(function (ok) {
        if (ok && CB.app.book === book && L.getTxn(book, id) === existing) save();
        else CB.status('Not saved. The reconciled transaction is unchanged.');
      });
      return false;
    }
    save();
    return true;

    function save() {
      // remember new payees automatically
      CB.lists.ensurePayee(payee);
      splits.forEach(function (s) { CB.lists.ensurePayee(s.payee); });

      var txn, message;
      if (id) {
        txn = L.getTxn(book, id);
        Object.assign(txn, { type: type, number: number, date: date, payee: payee, amount: amount, memo: memo, splits: splits });
        message = 'Changes saved.';
      } else {
        txn = L.newTxn(book, { kind: kind, type: type, number: number, date: date, payee: payee, amount: amount, memo: memo, splits: splits });
        book.transactions.push(txn);
        message = (kind === 'payment' ? type + ' ' : 'Deposit ') + M.format(amount) + (kind === 'payment' ? ' to ' : ' from ') + payee + ' recorded.';
      }
      CB.app.selectedId = txn.id;
      CB.app.commit(message);
      if (kind === 'payment') resetPayment(); else resetDeposit();
      CB.register.scrollToSelected();
    }
  }

  /* ---------- delete ---------- */
  function deleteSelected() {
    var book = CB.app.book;
    var t = CB.app.selectedId && L.getTxn(book, CB.app.selectedId);
    if (!t) { CB.dialog('Delete', 'Click a transaction in the register first, then choose Delete.'); return; }
    var warning = CB.reconcile.warningFor(book, t) || L.voidDeleteWarning(t);   // null unless it is reconciled or void
    CB.dialog('Delete Transaction',
      (warning ? '<div class="edit-banner">' + esc(warning) + '</div><br>' : '') +
      'Delete this transaction?<br><br><b>' + esc(CB.util.fmtDate(t.date)) + ' &nbsp; ' + esc(L.numberLabel(t)) + ' &nbsp; ' + esc(t.payee) +
      ' &nbsp; ' + M.format(t.amount) + '</b><br><br>This cannot be undone.',
      [{ label: 'Delete', value: true, primary: !warning }, { label: 'Cancel', value: false, primary: !!warning }]
    ).then(function (ok) {
      if (!ok) return;
      book.transactions = book.transactions.filter(function (x) { return x.id !== t.id; });
      if (CB.app.editing.payment === t.id) resetPayment();
      if (CB.app.editing.deposit === t.id) resetDeposit();
      CB.app.selectedId = null;
      CB.app.commit('Transaction deleted.');
    });
  }

  /* ---------- void / unvoid (checks only) ---------- */
  function txnSummary(t) {
    return esc(CB.util.fmtDate(t.date)) + ' &nbsp; ' + esc(L.numberLabel(t)) + ' &nbsp; ' + esc(t.payee) + ' &nbsp; ' + M.format(t.amount);
  }

  function voidCheck(id) {
    var book = CB.app.book;
    var t = id ? L.getTxn(book, id) : null;
    var can = L.canVoid(book, t);
    if (!can.ok) { CB.dialog('Void Check', esc(can.reason)); return; }
    var draft = book.reconcileDraft;
    var inDraft = !!draft && Array.isArray(draft.tickedIds) && draft.tickedIds.indexOf(t.id) !== -1;
    CB.dialog('Void Check',
      (can.cleared ? '<div class="edit-banner">This check is marked <b>c</b> (cleared): the bank has paid it. A check the bank has paid ' +
        'can’t really be voided. Voiding it here makes your register disagree with the bank, and your next reconciliation won’t balance. ' +
        'If the bank paid it, click Cancel.</div><br>' : '') +
      'Void this check?<br><br><b>' + txnSummary(t) + '</b><br><br>' +
      'It stays in the register with its number, date and payee, shows VOID, and counts as ' + M.format(0) + '. ' +
      'Its amount is kept, so you can Unvoid it later.' +
      (inDraft ? '<br><br>It is ticked in your unfinished reconciliation; voiding it removes that tick.' : '') +
      (CB.app.editing.payment === t.id ? '<br><br>Any unsaved changes in the form are discarded.' : ''),
      [{ label: can.cleared ? 'Void Anyway' : 'Void', value: true, primary: !can.cleared }, { label: 'Cancel', value: false, primary: can.cleared }]
    ).then(function (ok) {
      if (!ok) { CB.status('Nothing was changed.'); return; }
      // things may have changed while the box was open
      if (CB.app.book !== book || L.getTxn(book, t.id) !== t) { CB.status('Nothing was changed: that check is no longer there.'); return; }
      var again = L.canVoid(book, t);
      if (!again.ok) { CB.dialog('Void Check', esc(again.reason)); return; }
      t.voidedAt = new Date().toISOString();
      if (book.reconcileDraft && Array.isArray(book.reconcileDraft.tickedIds)) {
        book.reconcileDraft.tickedIds = book.reconcileDraft.tickedIds.filter(function (x) { return x !== t.id; });
      }
      CB.app.selectedId = t.id;
      CB.app.commit(L.checkLabel(t) + ' voided. It now counts as ' + M.format(0) + '.');
      if (CB.app.editing.payment === t.id) loadInto(t);
    });
  }

  function unvoidCheck(id) {
    var book = CB.app.book;
    var t = id ? L.getTxn(book, id) : null;
    var can = L.canUnvoid(book, t);
    if (!can.ok) { CB.dialog('Unvoid Check', esc(can.reason)); return; }
    t.voidedAt = null;
    CB.app.selectedId = t.id;
    CB.app.commit(L.checkLabel(t) + ' unvoided. It counts as ' + M.format(t.amount) + ' again.');
    if (CB.app.editing.payment === t.id) loadInto(t);
  }

  // Edit menu: act on the check selected in the register
  function voidSelected() { voidCheck(CB.app.selectedId); }
  function unvoidSelected() { unvoidCheck(CB.app.selectedId); }

  function refreshAccounts() {
    if (splitsP) splitsP.refreshOptions();
    if (splitsD) splitsD.refreshOptions();
  }

  function init() {
    splitsP = new CB.SplitEditor('p', 'payment');
    splitsD = new CB.SplitEditor('d', 'deposit');

    $('#p-type').addEventListener('change', updateNumberField);
    $('#p-amount').addEventListener('input', function () { updateWords('p'); splitsP.syncSingle(); splitsP.update(); });
    $('#p-payee').addEventListener('input', function () { $('#p-address').textContent = payeeAddress(this.value); });
    $('#page-check').addEventListener('submit', function (e) { e.preventDefault(); record('payment'); });
    $('#page-check .js-clear').addEventListener('click', resetPayment);
    $('#p-void').addEventListener('click', function () {   // the button on the form: the check open in it
      var t = CB.app.editing.payment && L.getTxn(CB.app.book, CB.app.editing.payment);
      if (t && L.isVoided(t)) unvoidCheck(t.id); else voidCheck(CB.app.editing.payment);
    });

    $('#d-amount').addEventListener('input', function () { updateWords('d'); splitsD.syncSingle(); splitsD.update(); });
    $('#page-deposit').addEventListener('submit', function (e) { e.preventDefault(); record('deposit'); });
    $('#page-deposit .js-clear').addEventListener('click', resetDeposit);

    // tidy money fields when you leave them: "1,250.5" -> "1250.50"
    document.addEventListener('focusout', function (e) {
      if (e.target.classList && e.target.classList.contains('money') && e.target.value.trim()) {
        var c = M.toCents(e.target.value);
        if (isFinite(c)) e.target.value = M.plain(c);
      }
    });
  }

  return { init: init, resetPayment: resetPayment, resetDeposit: resetDeposit, loadInto: loadInto,
    record: record, deleteSelected: deleteSelected, voidSelected: voidSelected, unvoidSelected: unvoidSelected,
    refreshAccounts: refreshAccounts };
})();
