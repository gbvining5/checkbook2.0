/* =========================================================
   CB.lists — the Accounts & Payees tab and the Settings tab.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.lists = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$, esc = CB.util.esc;
  var M = CB.money, L = CB.ledger;

  function sortPayees() {
    CB.app.book.payees.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  }

  // Add a payee to the list if it's new (used when recording)
  function ensurePayee(name) {
    if (name && !L.findPayee(CB.app.book, name)) {
      CB.app.book.payees.push({ name: name, address: '', city: '' });
      sortPayees();
    }
  }

  function fillListbox(sel, items) {
    var prev = sel.value;
    sel.innerHTML = items.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    if (items.indexOf(prev) !== -1) sel.value = prev;
  }

  function render() {
    var book = CB.app.book;
    fillListbox($('#l-expense'), book.expenseAccounts);
    fillListbox($('#l-income'), book.incomeAccounts);
    fillListbox($('#l-payees'), book.payees.map(function (p) { return p.name; }));
    $('#payee-list').innerHTML = book.payees.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('');
    $('#s-company').value = book.settings.company;
    $('#s-bank').value = book.settings.bankAccount;
    $('#s-begin').value = M.plain(book.settings.beginningBalance);
  }

  /* ---------- accounts ---------- */
  function accountAction(which, act) {
    var book = CB.app.book;
    var list = which === 'expense' ? book.expenseAccounts : book.incomeAccounts;
    var sel = $('#l-' + which);
    var input = $('#l-' + which + '-name');
    var name = input.value.trim();
    var exists = function (n) { return list.some(function (a) { return a.toLowerCase() === n.toLowerCase(); }); };
    var msg;

    if (act === 'add') {
      if (!name) return CB.dialog('Add Account', 'Type a name in the box first.');
      if (exists(name)) return CB.dialog('Add Account', '"' + esc(name) + '" is already in the list.');
      list.push(name);
      input.value = '';
      msg = 'Account "' + name + '" added.';
    } else if (act === 'rename') {
      var old = sel.value;
      if (!old) return CB.dialog('Rename Account', 'Select an account in the list first.');
      if (!name) return CB.dialog('Rename Account', 'Type the new name in the box.');
      if (name !== old && exists(name)) return CB.dialog('Rename Account', '"' + esc(name) + '" is already in the list.');
      list[list.indexOf(old)] = name;
      var kind = which === 'expense' ? 'payment' : 'deposit', n = 0;
      book.transactions.forEach(function (t) {
        if (t.kind !== kind) return;
        t.splits.forEach(function (s) { if (s.account === old) { s.account = name; n++; } });
      });
      input.value = '';
      msg = 'Renamed "' + old + '" to "' + name + '"' + (n ? ' (updated ' + n + ' transaction lines).' : '.');
    } else if (act === 'remove') {
      var victim = sel.value;
      if (!victim) return CB.dialog('Remove Account', 'Select an account in the list first.');
      list.splice(list.indexOf(victim), 1);
      msg = 'Account "' + victim + '" removed. Past transactions keep the old name.';
    }
    CB.app.commit(msg);
  }

  /* ---------- payees ---------- */
  function payeeAction(act) {
    var book = CB.app.book;
    var sel = $('#l-payees');
    var name = $('#py-name').value.trim();
    var data = { name: name, address: $('#py-address').value.trim(), city: $('#py-city').value.trim() };
    var current = sel.value ? L.findPayee(book, sel.value) : null;
    var msg;

    if (act === 'add') {
      if (!name) return CB.dialog('Add Payee', 'Enter the payee name.');
      if (L.findPayee(book, name)) return CB.dialog('Add Payee', '"' + esc(name) + '" is already in the list. Select it and click Update to change it.');
      book.payees.push(data);
      msg = 'Payee "' + name + '" added.';
    } else if (act === 'update') {
      if (!current) return CB.dialog('Update Payee', 'Select a payee in the list first.');
      if (!name) return CB.dialog('Update Payee', 'The name cannot be blank.');
      var other = L.findPayee(book, name);
      if (other && other !== current) return CB.dialog('Update Payee', '"' + esc(name) + '" is already in the list.');
      var oldName = current.name;
      Object.assign(current, data);
      if (oldName !== name) {
        book.transactions.forEach(function (t) {
          if (t.payee === oldName) t.payee = name;
          t.splits.forEach(function (s) { if (s.payee === oldName) s.payee = name; });
        });
      }
      msg = 'Payee updated.';
    } else if (act === 'remove') {
      if (!current) return CB.dialog('Remove Payee', 'Select a payee in the list first.');
      book.payees.splice(book.payees.indexOf(current), 1);
      $('#py-name').value = $('#py-address').value = $('#py-city').value = '';
      msg = 'Payee removed. Past transactions keep the name.';
    }
    sortPayees();
    CB.app.commit(msg);
    if (act !== 'remove' && name) $('#l-payees').value = name;
  }

  /* ---------- settings ---------- */
  function applySettings() {
    var begin = M.toCents($('#s-begin').value || '0');
    if (!isFinite(begin)) {
      $('#s-begin').classList.add('invalid');
      return CB.dialog('Settings', 'Beginning balance must be a number, like 900000.00');
    }
    $('#s-begin').classList.remove('invalid');
    var book = CB.app.book;
    var company = $('#s-company').value.trim() || 'My Company';
    var bank = $('#s-bank').value.trim();
    function save() {
      var s = book.settings;
      s.company = company;
      s.bankAccount = bank;
      s.beginningBalance = begin;
      CB.app.commit('Settings saved.');
    }
    // the beginning balance feeds the first reconciliation: warn once anything is reconciled
    var warning = begin !== book.settings.beginningBalance ? CB.reconcile.beginningBalanceWarning(book) : null;
    if (!warning) return save();
    CB.dialog('Beginning Balance', esc(warning) + '<br><br>Save the change anyway?',
      [{ label: 'Save Anyway', value: true }, { label: 'Cancel', value: false, primary: true }]
    ).then(function (ok) {
      if (ok && CB.app.book === book) return save();
      $('#s-begin').value = M.plain(book.settings.beginningBalance);   // put the old value back; nothing saved
      CB.status('Settings not saved. The beginning balance is unchanged.');
    });
  }

  function init() {
    $$('[data-list]').forEach(function (b) {
      b.addEventListener('click', function () { accountAction(b.dataset.list, b.dataset.act); });
    });
    ['expense', 'income'].forEach(function (w) {
      $('#l-' + w).addEventListener('change', function () { $('#l-' + w + '-name').value = this.value; });
    });
    $('#l-payees').addEventListener('change', function () {
      var p = L.findPayee(CB.app.book, this.value);
      if (!p) return;
      $('#py-name').value = p.name; $('#py-address').value = p.address; $('#py-city').value = p.city;
    });
    $('#py-add').addEventListener('click', function () { payeeAction('add'); });
    $('#py-update').addEventListener('click', function () { payeeAction('update'); });
    $('#py-remove').addEventListener('click', function () { payeeAction('remove'); });
    $('#s-apply').addEventListener('click', applySettings);
  }

  return { init: init, render: render, ensurePayee: ensurePayee };
})();
