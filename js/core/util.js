/* =========================================================
   CB.util — small helpers shared by every other file.
   No DOM rendering and no app state here.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.util = (function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Unique id for transactions
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Today's date as YYYY-MM-DD (the format stored in the data)
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // YYYY-MM-DD -> MM/DD/YYYY (for display only)
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : String(iso);
  }

  // Escape text before putting it into innerHTML. ALWAYS use this for user text.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  return { $: $, $$: $$, pad: pad, uid: uid, today: today, fmtDate: fmtDate, esc: esc, isIsoDate: isIsoDate };
})();
