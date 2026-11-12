/* =========================================================
   CB.dialog — Windows-7 style message boxes (replaces alert/confirm,
   which freeze the page). CB.status — status bar messages.
   ========================================================= */
var CB = window.CB = window.CB || {};

(function () {
  'use strict';
  var $ = CB.util.$;
  var pending = null;
  var waiting = [];   // boxes asked for while another one is showing: shown in turn, never dropped

  // dialog(title, html, buttons) -> Promise resolving to the clicked button's value
  // buttons: [{ label, value, primary }]. Default: a single OK button.
  // Only one box shows at a time; a second one waits until the first is closed.
  CB.dialog = function (title, html, buttons) {
    return new Promise(function (resolve) {
      waiting.push({ title: title, html: html, buttons: buttons || [{ label: 'OK', value: true, primary: true }], resolve: resolve });
      if (!pending) showNext();
    });
  };

  function showNext() {
    var d = waiting.shift();
    if (!d) return;
    pending = d.resolve;
    $('#dlg-title').textContent = d.title;
    $('#dlg-body').innerHTML = d.html;
    var box = $('#dlg-buttons');
    box.innerHTML = '';
    var focusBtn = null;
    d.buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' default' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', function () { close(b.value); });
      box.appendChild(btn);
      if (b.primary) focusBtn = btn;
    });
    $('#overlay').hidden = false;
    (focusBtn || box.firstChild).focus();
  }

  function close(value) {
    $('#overlay').hidden = true;
    var r = pending; pending = null;
    if (r) r(value);
    showNext();
  }

  // "Please Fix" box listing problems (plain text; each message shown once)
  CB.dialog.errors = function (messages) {
    var uniq = messages.filter(function (m, i) { return messages.indexOf(m) === i; });
    return CB.dialog('Please Fix', '<ul><li>' + uniq.map(CB.util.esc).join('</li><li>') + '</li></ul>');
  };
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
