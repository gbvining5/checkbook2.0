#!/usr/bin/env node
/* Runs tests/unit.tests.js against js/core/*.js in Node (no browser needed).
   Usage:  node tests/run-unit.js            Exit code 1 if any test fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
// Same order as index.html
const files = [
  'js/core/version.js',
  'js/core/util.js',
  'js/core/money.js',
  'js/core/schema.js',
  'js/core/store.js',
  'js/core/ledger.js',
  'js/core/reconcile.js',
  'tests/harness.js',
  'tests/unit.tests.js'
];

const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const r = sandbox.runTests();
for (const t of r.results) {
  console.log((t.ok ? '  ✔ ' : '  ✘ ') + t.name + (t.ok ? '' : '\n      ' + t.error));
}
console.log('\n' + r.passed + ' passed, ' + r.failed + ' failed');
process.exit(r.failed ? 1 : 0);
