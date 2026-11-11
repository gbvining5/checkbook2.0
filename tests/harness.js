/* Tiny test harness that works both in Node and in a browser page.
   test('name', function () { eq(actual, expected); ok(condition, 'message'); throws(fn); }); */
(function (root) {
  'use strict';
  var tests = [];

  function fmt(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
  function same(a, b) { return a === b || (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) || fmt(a) === fmt(b); }

  root.test = function (name, fn) { tests.push({ name: name, fn: fn }); };
  root.eq = function (actual, expected, msg) {
    if (!same(actual, expected)) throw new Error((msg ? msg + ': ' : '') + 'expected ' + fmt(expected) + ' but got ' + fmt(actual));
  };
  root.ok = function (cond, msg) { if (!cond) throw new Error(msg || 'expected true'); };
  root.throws = function (fn, msg) {
    try { fn(); } catch (e) { return e; }
    throw new Error(msg || 'expected an error to be thrown');
  };

  // Runs all tests; returns { passed, failed, results:[{name, ok, error}] }
  root.runTests = function () {
    var results = tests.map(function (t) {
      try { t.fn(); return { name: t.name, ok: true }; }
      catch (e) { return { name: t.name, ok: false, error: e.message }; }
    });
    var failed = results.filter(function (r) { return !r.ok; }).length;
    return { passed: results.length - failed, failed: failed, results: results };
  };
})(typeof window !== 'undefined' ? window : globalThis);
