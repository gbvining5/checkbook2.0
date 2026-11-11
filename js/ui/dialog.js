/* =========================================================
   CB.dialog — Windows-7 style message boxes (replaces alert/confirm,
   which freeze the page). CB.status — status bar messages.
   ========================================================= */
var CB = window.CB = window.CB || {};

(function () {
  'use strict';
  var $ = CB.util.$;
  var pending = null;

  // dialog(title, html, buttons) -> Promise resolving to the clicked button's value
  // buttons: [{ label, value, primary }]. Default: a single OK button.
  CB.dialog = function (title, html, buttons) {
    buttons = buttons || [{ label: 'OK', value: true, primary: true }];
    if (pending) close(null); // only one dialog at a time
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = html;
    var box = $('#dlg-buttons');
    box.innerHTML = '';
    var focusBtn = null;
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' default' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', function () { close(b.value); });
      box.appendChild(btn);
      if (b.primary) focusBtn = btn;
    });
    $('#overlay').hidden = false;
    (focusBtn || box.firstChild).focus();
    return new Promise(function (resolve) { pending = resolve; });
  };

  function close(value) {
    $('#overlay').hidden = true;
    var r = pending; pending = null;
    if (r) r(value);
  }
  CB.dialog.close = close;
  CB.dialog.isOpen = function () { return !$('#overlay').hidden; };

  var timer = null;
  CB.status = function (msg) {
    var el = $('#sb-msg');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { el.textContent = 'Ready'; }, 5000);
  };

  document.addEventListener('DOMContentLoaded', function () {
    $('#dlg-x').addEventListener('click', function () { close(null); });
  });
})();
