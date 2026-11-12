/* =========================================================
   CB.store — loading and saving the checkbook in the browser.

   Safety rules this file enforces:
   - Never silently throw away data. Unreadable data is copied
     to a "rescue" key before anything else happens.
   - Before upgrading old data, keep a copy of the original.
   - If the data came from a NEWER app version, or is damaged so
     badly the screens can't draw it, refuse to save (saving would
     overwrite it). Saving only comes back on once a rescue copy
     exists, or the user confirms they have it as a downloaded file.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.store = (function () {
  'use strict';

  var KEY = 'checkbook.v1';          // storage key (name kept for compatibility; version lives inside the data)
  var RESCUE_PREFIX = 'checkbook.rescue.';
  var PREMIGRATE_PREFIX = 'checkbook.before-upgrade.v';

  var state = {
    saveBlocked: false,   // true when saving would destroy data we can't read
    blockedRescued: false, // true once that blocked data has a rescue copy
    warnings: []          // messages to show the user after load
  };

  var RECOVER_HINT = ' (File &gt; Recover Rescue Copies)';

  // Upgrade old data. Damaged entries can make an upgrade crash: report that as damage.
  function upgrade(data) {
    try { return CB.schema.migrate(data); }
    catch (e) {
      if (e instanceof TypeError) { var d = new Error('it cannot be upgraded'); d.damaged = true; throw d; }
      throw e;
    }
  }

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // Returns the book to use. Never throws.
  function load() {
    state.saveBlocked = false;
    state.blockedRescued = false;
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
        'The unreadable data was kept in a rescue copy inside this browser' + RECOVER_HINT + '. Open a backup file to restore your work.');
      return CB.schema.sampleBook();
    }

    if (!CB.schema.looksLikeBook(data)) {
      rescue(ls, raw);
      state.warnings.push('The saved data did not look like a checkbook, so a fresh one was started. A rescue copy was kept' + RECOVER_HINT + '.');
      return CB.schema.sampleBook();
    }

    var oldVersion = data.version == null ? 1 : data.version;
    try {
      if (oldVersion < CB.schema.VERSION) {
        try { ls.setItem(PREMIGRATE_PREFIX + oldVersion, raw); } catch (e) { /* storage full: carry on */ }
      }
      data = upgrade(data);
    } catch (e) {
      if (e.damaged) return blockDamaged(ls, raw, e.message);
      // Newer version, or no upgrade path: show nothing editable rather than risk overwriting it.
      state.saveBlocked = true;
      state.warnings.push(e.message + ' Saving is turned off so your data is not damaged.');
      return CB.schema.blankBook();
    }

    var damage = CB.schema.findDamage(data);
    if (damage) return blockDamaged(ls, raw, damage);

    var problems = CB.schema.validate(data);
    if (problems.length) {
      state.warnings.push('Some saved entries look wrong. Your data was loaded, but please check these and save a backup:<br>&bull; ' +
        problems.slice(0, 8).map(CB.util.esc).join('<br>&bull; ') + (problems.length > 8 ? '<br>&hellip;and ' + (problems.length - 8) + ' more.' : ''));
    }
    return data;
  }

  // Saved data the screens can't draw: don't show it, don't overwrite it, keep a rescue copy.
  function blockDamaged(ls, raw, damage) {
    state.saveBlocked = true;
    state.blockedRescued = rescue(ls, raw);
    state.warnings.push('Your saved checkbook is damaged (' + CB.util.esc(damage) + '), so this copy of CheckBook cannot show it. ' +
      'It was not changed: saving is turned off' + (state.blockedRescued ? ' and a rescue copy was kept' + RECOVER_HINT : '') + '.<br><br>' +
      'To get back to work, open a backup with <b>File &gt; Open Backup</b>.');
    return CB.schema.blankBook();
  }

  // Returns true if the copy was written.
  function rescue(ls, raw) {
    try { if (!ls) return false; ls.setItem(RESCUE_PREFIX + Date.now(), raw); return true; } catch (e) { return false; }
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
    // Entries the app cannot even draw would be saved and then blank the register on every start: refuse them.
    var damage;
    try { data = upgrade(data); damage = CB.schema.findDamage(data); }
    catch (e) { if (!e.damaged) throw e; damage = e.message; }
    if (damage) throw new Error('That backup is damaged (' + damage + '), so it was not opened. Nothing was changed.');
    return { book: data, problems: CB.schema.validate(data) };
  }

  /* ---------- when saving is blocked ---------- */
  // The stored text that saving is protecting (null when saving isn't blocked)
  function blockedRaw() {
    if (!state.saveBlocked) return null;
    var ls = storage();
    try { return ls ? ls.getItem(KEY) : null; } catch (e) { return null; }
  }

  // Make sure the blocked data has a rescue copy. Returns false if it couldn't be written (e.g. storage full).
  function keepRescue() {
    if (!state.saveBlocked || state.blockedRescued) return true;
    var raw = blockedRaw();
    if (raw == null) return true;   // nothing stored to protect
    state.blockedRescued = rescue(storage(), raw);
    return state.blockedRescued;
  }

  // Turn saving back on (after the user opens a backup or starts a new book).
  // Refuses (returns false, saving stays off) unless the blocked data has a rescue copy,
  // or `confirmed` is true: the user said they have it as a downloaded file.
  function unblock(confirmed) {
    if (!state.saveBlocked) return true;
    if (!state.blockedRescued && !confirmed && blockedRaw() != null) return false;
    state.saveBlocked = false;
    state.blockedRescued = false;
    return true;
  }

  /* ---------- rescue copies (File > Recover Rescue Copies) ---------- */
  // [{ key, kind: 'rescue' | 'before-upgrade', time (ms) | null, version | null, size }], newest first
  function listRescues() {
    var ls = storage(), out = [];
    if (!ls) return out;
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i), v = ls.getItem(k) || '';
        if (k.indexOf(RESCUE_PREFIX) === 0) {
          var ms = Number(k.slice(RESCUE_PREFIX.length));
          out.push({ key: k, kind: 'rescue', time: isFinite(ms) ? ms : null, version: null, size: v.length });
        } else if (k.indexOf(PREMIGRATE_PREFIX) === 0) {
          out.push({ key: k, kind: 'before-upgrade', time: null, version: Number(k.slice(PREMIGRATE_PREFIX.length)) || null, size: v.length });
        }
      }
    } catch (e) { /* storage unreadable: list what we have */ }
    return out.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'rescue' ? -1 : 1;
      return a.kind === 'rescue' ? (b.time || 0) - (a.time || 0) : (b.version || 0) - (a.version || 0);
    });
  }

  // Text of one rescue copy (only rescue / before-upgrade keys), or null
  function readRescue(key) {
    if (typeof key !== 'string' || (key.indexOf(RESCUE_PREFIX) !== 0 && key.indexOf(PREMIGRATE_PREFIX) !== 0)) return null;
    var ls = storage();
    try { return ls ? ls.getItem(key) : null; } catch (e) { return null; }
  }

  return {
    KEY: KEY, load: load, save: save, parseBackup: parseBackup,
    get saveBlocked() { return state.saveBlocked; },
    blockedRaw: blockedRaw, keepRescue: keepRescue, unblock: unblock,
    listRescues: listRescues, readRescue: readRescue,
    get warnings() { return state.warnings.slice(); }
  };
})();
