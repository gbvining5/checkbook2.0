/* =========================================================
   CB.files — File menu: Save Backup, Open Backup, Export CSV,
   New Checkbook. Everything happens on this computer; nothing
   is uploaded anywhere.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.files = (function () {
  'use strict';
  var esc = CB.util.esc, M = CB.money, L = CB.ledger;

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileSafe(s) { return String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'CheckBook'; }

  function saveBackup() {
    var book = CB.app.book;
    download('CheckBook_' + fileSafe(book.settings.company) + '_' + CB.util.today() + '.json',
      JSON.stringify(book, null, 2), 'application/json');
    CB.status('Backup file downloaded. Keep it somewhere safe.');
  }

  function openBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = CB.store.parseBackup(reader.result); }
      catch (e) { CB.dialog('Open Backup', esc(e.message)); return; }

      var data = parsed.book;
      var warn = parsed.problems.length
        ? '<br><br><b>Warning:</b> this file has ' + parsed.problems.length + ' problem(s), e.g. ' + esc(parsed.problems[0])
        : '';
      CB.dialog('Open Backup',
        'Replace the checkbook on screen with <b>' + esc(file.name) + '</b>?<br>(' + data.transactions.length +
        ' transactions for ' + esc(data.settings.company) + ')' + warn +
        '<br><br>Tip: Save a backup of the current one first if you need it.',
        [{ label: 'Replace', value: true, primary: true }, { label: 'Cancel', value: false }]
      ).then(function (ok) {
        if (!ok) return;
        CB.app.replaceBook(data);
        CB.status('Opened ' + file.name + '.');
      });
    };
    reader.readAsText(file);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // stop Excel from running text as a formula
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(book) {
    var lines = [['Date', 'Number', 'Kind', 'Trans Type', 'Payee / Received From', 'Amount', 'Memo', 'Rec.', 'Balance',
      'Account', 'Line Amount', 'Line Memo', 'Line Payee'].join(',')];
    lines.push(['', '', '', 'Beginning Balance', '', '', '', '', M.plain(book.settings.beginningBalance), '', '', '', ''].join(','));
    L.withRunningBalance(book).forEach(function (r) {
      var t = r.t;
      (t.splits.length ? t.splits : [{}]).forEach(function (s, i) {
        var head = i === 0
          ? [CB.util.fmtDate(t.date), L.numberLabel(t), t.kind === 'deposit' ? 'Deposit' : 'Payment', t.type, t.payee,
             M.plain(L.signed(t)), t.memo, t.cleared ? 'X' : '', M.plain(r.balance)]
          : ['', '', '', '', '', '', '', '', ''];
        lines.push(head.concat([s.account || '', s.amount != null ? M.plain(t.kind === 'deposit' ? s.amount : -s.amount) : '',
          s.memo || '', s.payee || '']).map(csvCell).join(','));
      });
    });
    return '﻿' + lines.join('\r\n');
  }

  function exportCsv() {
    var book = CB.app.book;
    download('CheckBook_' + fileSafe(book.settings.company) + '_' + CB.util.today() + '.csv', buildCsv(book), 'text/csv');
    CB.status('Exported to CSV (opens in Excel).');
  }

  function newCheckbook() {
    CB.dialog('New Checkbook',
      'Start a new, empty checkbook?<br><br>The current one will be <b>erased</b> from this browser. Save a backup first if you want to keep it.',
      [{ label: 'Save Backup First', value: 'backup' }, { label: 'Start New', value: 'new', primary: true }, { label: 'Cancel', value: null }]
    ).then(function (v) {
      if (v === 'backup') { saveBackup(); return; }
      if (v !== 'new') return;
      CB.app.replaceBook(CB.schema.blankBook());
      CB.main.showTab('settings');
      CB.util.$('#s-company').focus();
      CB.status('New checkbook started. Enter your company name and beginning balance.');
    });
  }

  return { saveBackup: saveBackup, openBackup: openBackup, exportCsv: exportCsv, buildCsv: buildCsv, newCheckbook: newCheckbook };
})();
