/* =========================================================
   CB.store — loading and saving the checkbook in the browser.

   Safety rules this file enforces:
   - Never silently throw away data. Unreadable data is copied
     to a "rescue" key before anything else happens.
   - Before upgrading old data, keep a copy of the original.
   - If the data came from a NEWER app version, refuse to save
     (saving would overwrite it with an older format).
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.store = (function () {
  'use strict';

  var KEY = 'checkbook.v1';          // storage key (name kept for compatibility; version lives inside the data)
  var RESCUE_PREFIX = 'checkbook.rescue.';
  var PREMIGRATE_PREFIX = 'checkbook.before-upgrade.v';

  var state = {
    saveBlocked: false,   // true when saving would destroy data we can't read
    warnings: []          // messages to show the user after load
  };

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // Returns the book to use. Never throws.
  function load() {
    state.saveBlocked = false;
    state.warnings = [];
    var ls = storage();
    var raw = null;
    try { raw = ls ? ls.getItem(KEY) : null; } catch (e) { raw = null; }

    if (!raw) return CB.schema.sampleBook();   // first visit

    var data;
    try { data = JSON.parse(raw); }
    catch (e) {
      rescue(ls, raw);
      state.warnings.push('Your saved checkbook could not be read, so a fresh one was started. ' +
        'The unreadable data was kept in a rescue copy inside this browser. Open a backup file to restore your work.');
      return CB.schema.sampleBook();
    }

    if (!CB.schema.looksLikeBook(data)) {
      rescue(ls, raw);
      state.warnings.push('The saved data did not look like a checkbook, so a fresh one was started. A rescue copy was kept.');
      return CB.schema.sampleBook();
    }

    var oldVersion = data.version == null ? 1 : data.version;
    try {
      if (oldVersion < CB.schema.VERSION) {
        try { ls.setItem(PREMIGRATE_PREFIX + oldVersion, raw); } catch (e) { /* storage full: carry on */ }
      }
      data = CB.schema.migrate(data);
    } catch (e) {
      // Newer version, or no upgrade path: show nothing editable rather than risk overwriting it.
      state.saveBlocked = true;
      state.warnings.push(e.message + ' Saving is turned off so your data is not damaged.');
      return CB.schema.blankBook();
    }

    var problems = CB.schema.validate(data);
    if (problems.length) {
      state.warnings.push('Some saved entries look wrong. Your data was loaded, but please check these and save a backup:<br>&bull; ' +
        problems.slice(0, 8).map(CB.util.esc).join('<br>&bull; ') + (problems.length > 8 ? '<br>&hellip;and ' + (problems.length - 8) + ' more.' : ''));
    }
    return data;
  }

  function rescue(ls, raw) {
    try { if (ls) ls.setItem(RESCUE_PREFIX + Date.now(), raw); } catch (e) { /* ignore */ }
  }

  // Returns true if saved.
  function save(book) {
    if (state.saveBlocked) return false;
    var ls = storage();
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(book)); return true; }
    catch (e) { return false; }
  }

  // Parse + upgrade + check a backup file's text. Returns { book, problems } or throws Error.
  function parseBackup(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not a CheckBook backup (it is not valid JSON).'); }
    if (!CB.schema.looksLikeBook(data)) throw new Error('That file is not a CheckBook backup.');
    data = CB.schema.migrate(data);
    return { book: data, problems: CB.schema.validate(data) };
  }

  return {
    KEY: KEY, load: load, save: save, parseBackup: parseBackup,
    get saveBlocked() { return state.saveBlocked; },
    unblock: function () { state.saveBlocked = false; },
    get warnings() { return state.warnings.slice(); }
  };
})();
