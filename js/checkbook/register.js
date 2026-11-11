/* =========================================================
   CB.register — draws the check register (left side), the
   balances in the status bar, and the title/address bar.
   Read-only: it never changes the book.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.register = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$, esc = CB.util.esc, fmtDate = CB.util.fmtDate;
  var money = CB.money.format;

  function bookTitle() {
    var s = CB.app.book.settings;
    return 'CheckBook: ' + s.company + (s.bankAccount ? '  -  Banking Account ' + s.bankAccount : '');
  }

  function renderHeader() {
    var book = CB.app.book;
    var b = CB.ledger.balances(book);
    document.title = 'CheckBook - ' + book.settings.company;
    $('#title-text').textContent = 'CheckBook - ' + book.settings.company;
    $('#addr-text').textContent = bookTitle();
    $$('.js-check-title').forEach(function (el) { el.textContent = bookTitle(); });
    $$('.js-curbal').forEach(function (el) { el.textContent = money(b.current); });
    $('#sb-begin').textContent = money(book.settings.beginningBalance);
    $('#sb-cleared').textContent = money(b.cleared);
    var cur = $('#sb-current');
    cur.textContent = money(b.current);
    cur.className = b.current < 0 ? 'sb-neg' : '';
    var n = book.transactions.length;
    $('#sb-count').textContent = n + ' transaction' + (n === 1 ? '' : 's');
  }

  function rowHtml(t, balance) {
    var L = CB.ledger;
    var amtClass = t.kind === 'deposit' ? 'pos' : 'neg';
    var amtText = (t.kind === 'deposit' ? '+' : '-') + money(t.amount).replace('-', '');
    return '<tr class="r1">' +
        '<td>' + esc(fmtDate(t.date)) + '</td>' +
        '<td>' + esc(L.numberLabel(t)) + '</td>' +
        '<td title="' + esc(t.payee) + '">' + esc(t.payee) + '</td>' +
        '<td class="num ' + amtClass + '">' + amtText + '</td>' +
        '<td class="rec"><input type="checkbox" class="rec-box" title="Cleared the bank"' + (t.cleared ? ' checked' : '') + '></td>' +
        '<td class="num' + (balance < 0 ? ' bal-neg' : '') + '">' + money(balance) + '</td>' +
      '</tr>' +
      '<tr class="r2">' +
        '<td></td>' +
        '<td title="' + esc(L.accountLabel(t)) + '">' + esc(L.accountLabel(t)) + '</td>' +
        '<td title="' + esc(t.memo) + '">' + esc(t.memo) + '</td>' +
        '<td colspan="3">' + esc(t.type) + '</td>' +
      '</tr>';
  }

  function render() {
    var book = CB.app.book;
    var table = $('#register');
    $$('tbody', table).forEach(function (tb) { tb.remove(); });

    var q = $('#find').value.trim().toLowerCase();
    var rows = CB.ledger.withRunningBalance(book).filter(function (r) {
      return !q || CB.ledger.searchText(r.t).indexOf(q) !== -1;
    });

    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var tb = document.createElement('tbody');
      tb.dataset.id = r.t.id;
      if (r.t.id === CB.app.selectedId) tb.className = 'selected';
      tb.innerHTML = rowHtml(r.t, r.balance);
      frag.appendChild(tb);
    });
    table.appendChild(frag);

    var empty = $('#empty-msg');
    empty.hidden = rows.length > 0;
    empty.innerHTML = book.transactions.length && q
      ? 'No transactions match &ldquo;' + esc(q) + '&rdquo;.'
      : 'No transactions yet. Click <b>Write Check</b> or <b>Make Deposit</b> to add one.';
  }

  function scrollToSelected() {
    var tb = $('#register tbody.selected');
    if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: 'nearest' });
  }

  function init() {
    $('#find').addEventListener('input', render);

    // click = select & edit; Rec. checkbox = mark cleared
    $('#register').addEventListener('click', function (e) {
      var tb = e.target.closest('tbody');
      if (!tb) return;
      var t = CB.ledger.getTxn(CB.app.book, tb.dataset.id);
      if (!t) return;
      if (e.target.classList.contains('rec-box')) {
        t.cleared = e.target.checked;
        CB.app.save();
        renderHeader();
        CB.status(t.cleared ? 'Marked as cleared.' : 'Marked as not cleared.');
        return;
      }
      CB.app.selectedId = t.id;
      $$('#register tbody').forEach(function (x) { x.classList.toggle('selected', x === tb); });
      CB.forms.loadInto(t);
    });
  }

  return { init: init, render: render, renderHeader: renderHeader, scrollToSelected: scrollToSelected };
})();
