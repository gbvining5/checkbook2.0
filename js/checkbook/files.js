/* =========================================================
   CB.files — File menu: Save Backup, Open Backup, Export CSV,
   New Checkbook, Recover Rescue Copies. Everything happens on
   this computer; nothing is uploaded anywhere.
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

  /* ---------- before replacing data this copy can't open ---------- */
  // Saving is off because the stored checkbook can't be opened by this copy (newer version, or damaged).
  // Before it is replaced: download it as a file and keep a rescue copy. Only go on if the rescue copy
  // was written, or the user confirms they have the downloaded file.
  // Resolves to null (stop, nothing changed) or { confirmed } to pass to CB.app.replaceBook().
  function protectStored() {
    var raw = CB.store.blockedRaw();
    if (raw == null) return Promise.resolve({ confirmed: false });
    var name = 'CheckBook_saved-data_' + CB.util.today() + '.json';
    return CB.dialog('Keep the Saved Checkbook',
      'The checkbook saved in this browser can’t be opened by this copy of CheckBook (version ' + esc(CB.APP_VERSION) + '), ' +
      'so saving was turned off to protect it. It may be from a newer version, or damaged.<br><br>' +
      'Before it is replaced, CheckBook will download it as <b>' + esc(name) + '</b> and keep a rescue copy in this browser. ' +
      'You can open that file later with a newer copy of CheckBook.',
      [{ label: 'Download and Continue', value: true, primary: true }, { label: 'Cancel', value: false }]
    ).then(function (ok) {
      if (!ok) { CB.status('Nothing was changed.'); return null; }
      download(name, raw, 'application/json');
      if (CB.store.keepRescue()) return { confirmed: false };
      return CB.dialog('No Rescue Copy',
        'CheckBook could not keep a rescue copy (this browser’s storage may be full). ' +
        'The downloaded file <b>' + esc(name) + '</b> is now the only copy of the saved checkbook.<br><br>' +
        'Check that it is in your Downloads folder before continuing: continuing replaces the saved one.',
        [{ label: 'I Have the File, Continue', value: true }, { label: 'Cancel', value: false, primary: true }]
      ).then(function (have) {
        if (!have) { CB.status('Nothing was changed.'); return null; }
        return { confirmed: true };
      });
    });
  }

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
        return ok ? protectStored() : null;
      }).then(function (go) {
        if (!go || !CB.app.replaceBook(data, go.confirmed)) return;
        CB.status('Opened ' + file.name + '.');
      });
    };
    reader.readAsText(file);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    // stop Excel from running text as a formula; only a plain number like -5.00 may start with "-"
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
             M.plain(L.signed(t)), t.memo, t.reconciledId != null ? 'R' : t.cleared ? 'X' : '', M.plain(r.balance)]
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
      if (v === 'backup') { saveBackup(); return null; }
      return v === 'new' ? protectStored() : null;
    }).then(function (go) {
      if (!go || !CB.app.replaceBook(CB.schema.blankBook(), go.confirmed)) return;
      CB.main.showTab('settings');
      CB.util.$('#s-company').focus();
      CB.status('New checkbook started. Enter your company name and beginning balance.');
    });
  }

  /* ---------- File > Recover Rescue Copies ---------- */
  function rescueLabel(r) {
    if (r.kind === 'before-upgrade') return 'Copy kept before upgrading from data format ' + (r.version || '?');
    return 'Rescue copy, ' + (r.time ? new Date(r.time).toLocaleString() : 'unknown time');
  }
  function rescueFileName(r) {
    if (r.kind === 'before-upgrade') return 'CheckBook_before-upgrade_v' + (r.version || 'x') + '.json';
    var d = new Date(r.time || 0), p = CB.util.pad;
    return 'CheckBook_rescue_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }

  function showRescues() {
    var list = CB.store.listRescues();
    var body = !list.length ? 'There are no rescue copies in this browser.' :
      'CheckBook keeps these copies in this browser when it finds saved data it can’t use, and before it upgrades your data to a new format. ' +
      'Nothing here is deleted.<br><br>To use one: <b>Download</b> it, then open the file with <b>File &gt; Open Backup</b>.' +
      '<table class="rescue-list" id="rescue-list">' + list.map(function (r) {
        return '<tr><td>' + esc(rescueLabel(r)) + '</td><td class="num">' + Math.max(1, Math.round(r.size / 1024)) + ' KB</td>' +
          '<td><button type="button" class="btn small" data-rescue-key="' + esc(r.key) + '">Download</button></td></tr>';
      }).join('') + '</table>';
    CB.dialog('Recover Rescue Copies', body);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rescue-key]');
    if (!b) return;
    var key = b.getAttribute('data-rescue-key');
    var r = CB.store.listRescues().filter(function (x) { return x.key === key; })[0];
    var text = r ? CB.store.readRescue(key) : null;
    if (text == null) { CB.status('That rescue copy is no longer there.'); return; }
    download(rescueFileName(r), text, 'application/json');
    CB.status('Downloaded ' + rescueFileName(r) + '. Open it with File > Open Backup.');
  });

  return { saveBackup: saveBackup, openBackup: openBackup, exportCsv: exportCsv, buildCsv: buildCsv, newCheckbook: newCheckbook,
    protectStored: protectStored, showRescues: showRescues };
})();
