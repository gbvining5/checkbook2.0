/* =========================================================
   CB.forms — the Write Check and Make Deposit forms:
   fill, clear, validate, record, edit, delete.
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
    var warning = CB.reconcile.warningFor(book, t);   // null unless it is reconciled
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
    record: record, deleteSelected: deleteSelected, refreshAccounts: refreshAccounts };
})();
