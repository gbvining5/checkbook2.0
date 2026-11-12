/* =========================================================
   CB.app — the ONE place the open checkbook lives.

   How to change data (always the same pattern):
     var book = CB.app.book;
     ...change book...
     CB.app.commit('Message for status bar');   // saves + redraws

   Never call localStorage directly from feature files.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.app = (function () {
  'use strict';

  var app = {
    book: null,
    selectedId: null,                       // highlighted row in the register
    editing: { payment: null, deposit: null } // id being edited in each form
  };

  var saveWarned = false;

  app.save = function () {
    var ok = CB.store.save(app.book);
    if (!ok && !saveWarned) {
      saveWarned = true;
      CB.dialog('Not Saving',
        CB.store.saveBlocked
          ? 'Saving is turned off because the stored checkbook could not be safely opened. Use <b>File &gt; Open Backup</b> to load a backup.'
          : 'This browser is blocking storage, so changes will be lost when you close the page.<br><br>Use <b>File &gt; Save Backup</b> to keep your work.');
    }
    return ok;
  };

  // Redraw everything that shows book data
  app.renderAll = function () {
    CB.register.renderHeader();
    CB.register.render();
    CB.lists.render();
    CB.forms.refreshAccounts();
    if (CB.reconcileUI) CB.reconcileUI.render();   // keep the Reconcile window's totals current
  };

  // Save, redraw, and optionally show a status message
  app.commit = function (message) {
    app.save();
    app.renderAll();
    if (message) CB.status(message);
  };

  // Replace the whole book (open backup / new checkbook).
  // If saving is blocked, call CB.files.protectStored() first: this refuses (returns false,
  // nothing changes) unless the stored data has a rescue copy or `confirmed` is true.
  app.replaceBook = function (book, confirmed) {
    if (!CB.store.unblock(confirmed)) return false;
    app.book = book;
    app.selectedId = null;
    saveWarned = false;
    app.save();
    app.renderAll();
    CB.forms.resetPayment();
    CB.forms.resetDeposit();
    return true;
  };

  return app;
})();
