/* =========================================================
   CB.SplitEditor — the "Account | Amount | Memo | Payee" table
   under each form. Lets one check or deposit be spread over
   several accounts. With one line, its amount always equals the total.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.SplitEditor = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$, esc = CB.util.esc;
  var M = CB.money;

  // prefix: 'p' (payment form) or 'd' (deposit form); kind: 'payment' | 'deposit'
  function SplitEditor(prefix, kind) {
    var self = this;
    this.kind = kind;
    this.body = $('#' + prefix + '-splits');
    this.amountInput = $('#' + prefix + '-amount');
    this.remaining = $('#' + prefix + '-remaining');
    $('#' + prefix + '-addsplit').addEventListener('click', function () { self.addRow(); self.update(); });
    this.body.addEventListener('input', function () { self.update(); });
    this.body.addEventListener('click', function (e) {
      if (e.target.classList.contains('x')) {
        e.target.closest('tr').remove();
        if (!self.body.rows.length) self.addRow();
        self.syncSingle();
        self.update();
      }
    });
  }

  SplitEditor.prototype.accounts = function () {
    var book = CB.app.book;
    return this.kind === 'payment' ? book.expenseAccounts : book.incomeAccounts;
  };

  SplitEditor.prototype.optionsHtml = function (selected) {
    var list = this.accounts().slice();
    if (selected && list.indexOf(selected) === -1) list.push(selected); // keep old/removed account names visible
    return '<option value="">(choose)</option>' + list.map(function (a) {
      return '<option' + (a === selected ? ' selected' : '') + '>' + esc(a) + '</option>';
    }).join('');
  };

  SplitEditor.prototype.addRow = function (s) {
    s = s || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><select class="sp-acct">' + this.optionsHtml(s.account) + '</select></td>' +
      '<td><input class="sp-amt money" inputmode="decimal" style="text-align:right" value="' + (s.amount != null ? M.plain(s.amount) : '') + '"></td>' +
      '<td><input class="sp-memo" value="' + esc(s.memo || '') + '"></td>' +
      '<td><input class="sp-payee" list="payee-list" value="' + esc(s.payee || '') + '"></td>' +
      '<td><button type="button" class="btn small x" title="Remove line">&#10005;</button></td>';
    this.body.appendChild(tr);
    return tr;
  };

  SplitEditor.prototype.refreshOptions = function () {
    var self = this;
    $$('.sp-acct', this.body).forEach(function (sel) {
      var v = sel.value;
      sel.innerHTML = self.optionsHtml(v);
      sel.value = v;
    });
  };

  SplitEditor.prototype.reset = function () { this.body.innerHTML = ''; this.addRow(); this.update(); };

  SplitEditor.prototype.load = function (splits) {
    var self = this;
    this.body.innerHTML = '';
    (splits && splits.length ? splits : [{}]).forEach(function (s) { self.addRow(s); });
    this.update();
  };

  SplitEditor.prototype.syncSingle = function () {
    if (this.body.rows.length === 1) {
      var c = M.toCents(this.amountInput.value);
      $('.sp-amt', this.body).value = isFinite(c) ? M.plain(c) : '';
    }
  };

  // -> [{ account, amountRaw, amount (cents or NaN), memo, payee, row }]
  SplitEditor.prototype.read = function () {
    return $$('tr', this.body).map(function (tr) {
      return {
        row: tr,
        account: $('.sp-acct', tr).value,
        amountRaw: $('.sp-amt', tr).value,
        amount: M.toCents($('.sp-amt', tr).value),
        memo: $('.sp-memo', tr).value.trim(),
        payee: $('.sp-payee', tr).value.trim()
      };
    });
  };

  SplitEditor.prototype.update = function () {
    var rows = this.read();
    if (rows.length <= 1) { this.remaining.textContent = ''; this.remaining.className = 'remaining'; return; }
    var total = M.toCents(this.amountInput.value);
    if (!isFinite(total)) total = 0;
    var sum = rows.reduce(function (s, r) { return s + (isFinite(r.amount) ? r.amount : 0); }, 0);
    var diff = total - sum;
    if (diff === 0) { this.remaining.textContent = 'Lines add up to the total ✔'; this.remaining.className = 'remaining ok'; }
    else { this.remaining.textContent = 'Left to assign: ' + M.format(diff); this.remaining.className = 'remaining bad'; }
  };

  return SplitEditor;
})();
