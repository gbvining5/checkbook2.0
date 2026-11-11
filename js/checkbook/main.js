/* =========================================================
   CB.main — starts the CheckBook window: menus, toolbar,
   tabs, keyboard. Load this file LAST (see index.html).
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.main = (function () {
  'use strict';
  var $ = CB.util.$, $$ = CB.util.$$;

  function showTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    var map = { check: 'page-check', deposit: 'page-deposit', lists: 'page-lists', settings: 'page-settings' };
    $$('.tab-page').forEach(function (p) { p.classList.toggle('active', p.id === map[name]); });
  }

  function showAbout() {
    CB.dialog('About CheckBook',
      '<b>CheckBook</b> &mdash; a simple check register.<br>' +
      'Works offline in any web browser. No account or internet needed.<br><br>' +
      'Data is stored in this browser only. Use <b>Save Backup</b> to keep a copy.<br>' +
      '<span style="color:#666">Data format version ' + CB.schema.VERSION + '</span>');
  }

  // Every menu item / toolbar button has data-cmd="..." and lands here
  function runCommand(cmd) {
    closeMenus();
    switch (cmd) {
      case 'check': showTab('check'); if (!CB.app.editing.payment) CB.forms.resetPayment(); $('#p-payee').focus(); break;
      case 'deposit': showTab('deposit'); if (!CB.app.editing.deposit) CB.forms.resetDeposit(); $('#d-payee').focus(); break;
      case 'delete': CB.forms.deleteSelected(); break;
      case 'save': CB.files.saveBackup(); break;
      case 'open': $('#file-open').value = ''; $('#file-open').click(); break;
      case 'csv': CB.files.exportCsv(); break;
      case 'print': window.print(); break;
      case 'new': CB.files.newCheckbook(); break;
      case 'lists': showTab('lists'); break;
      case 'settings': showTab('settings'); break;
      case 'help': if (window.Desktop) Desktop.open('help'); break;
      case 'about': showAbout(); break;
    }
  }

  function closeMenus() { $$('.menu.open').forEach(function (m) { m.classList.remove('open'); }); }

  function bindChrome() {
    $$('.menu-title').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var menu = btn.parentNode, wasOpen = menu.classList.contains('open');
        closeMenus();
        if (!wasOpen) menu.classList.add('open');
      });
      btn.addEventListener('mouseenter', function () {
        if ($('.menu.open') && !btn.parentNode.classList.contains('open')) { closeMenus(); btn.parentNode.classList.add('open'); }
      });
    });
    document.addEventListener('click', closeMenus);
    $$('#win-checkbook [data-cmd]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); runCommand(el.dataset.cmd); });
    });
    $$('.tab').forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });
    $('#file-open').addEventListener('change', function () { if (this.files[0]) CB.files.openBackup(this.files[0]); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (CB.dialog.isOpen()) CB.dialog.close(null); else closeMenus(); }
    });
  }

  function start() {
    CB.app.book = CB.store.load();
    bindChrome();
    CB.register.init();
    CB.forms.init();
    CB.lists.init();
    CB.app.renderAll();
    CB.forms.resetPayment();
    CB.forms.resetDeposit();
    var wrap = $('#register-wrap');
    wrap.scrollTop = wrap.scrollHeight;

    // tell the user about anything that went wrong while loading
    var warnings = CB.store.warnings;
    if (warnings.length) CB.dialog('CheckBook', warnings.join('<br><br>'));
    else if (CB.store.saveBlocked) CB.dialog('CheckBook', 'Saving is turned off.');
    // first save after an upgrade writes the new format
    if (!CB.store.saveBlocked) CB.app.save();
  }

  return { start: start, showTab: showTab, runCommand: runCommand, about: showAbout };
})();

// Test hook + Start-menu "About"
window.CheckBook = {
  about: function () { CB.main.about(); },
  get state() { return CB.app.book; }
};

CB.main.start();
