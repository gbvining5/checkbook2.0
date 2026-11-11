/* =========================================================
   CB.money — all money math and formatting.
   RULE: money is always stored as WHOLE CENTS (integers).
         $150.00 is stored as 15000. Never store decimals.
   ========================================================= */
var CB = window.CB = window.CB || {};

CB.money = (function () {
  'use strict';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Text the user typed -> cents (integer). Returns NaN if it isn't a valid amount.
  // Parses the text directly (no floating point), so "1.005" rounds correctly to 101.
  // Accepts: "150", "150.5", "$1,234.56", "-20"
  function toCents(input) {
    if (typeof input === 'number') {
      if (!isFinite(input)) return NaN;
      input = input.toFixed(3);
    }
    var s = String(input == null ? '' : input).replace(/[$,\s]/g, '');
    var m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return NaN;
    var dollars = m[2] === '' ? 0 : parseInt(m[2], 10);
    var frac = (m[3] || '') + '000';
    var cents = dollars * 100 + parseInt(frac.slice(0, 2), 10);
    if (parseInt(frac.charAt(2), 10) >= 5) cents += 1; // round half up
    if (cents > 99999999999) return NaN;             // sanity limit: ~$1 billion
    return m[1] ? -cents : cents;
  }

  // cents -> "$1,234.56" (negative: "-$1,234.56")
  function format(cents) {
    var neg = cents < 0;
    var v = Math.abs(cents);
    var dollars = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + dollars + '.' + pad2(v % 100);
  }

  // cents -> "1234.56" (for input boxes and CSV)
  function plain(cents) {
    var neg = cents < 0, v = Math.abs(cents);
    return (neg ? '-' : '') + Math.floor(v / 100) + '.' + pad2(v % 100);
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var SCALES = ['', 'Thousand', 'Million', 'Billion'];

  function under1000(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
    if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
    else if (n > 0) out.push(ONES[n]);
    return out.join(' ');
  }

  // 15000 -> "One Hundred Fifty and 00/100 Dollars" (the line written on a check)
  function words(cents) {
    if (!isFinite(cents) || cents <= 0) return '';
    var dollars = Math.floor(cents / 100), c = cents % 100;
    var parts = [], i = 0;
    if (dollars === 0) parts.push('Zero');
    while (dollars > 0 && i < SCALES.length) {
      var chunk = dollars % 1000;
      if (chunk) parts.unshift(under1000(chunk) + (SCALES[i] ? ' ' + SCALES[i] : ''));
      dollars = Math.floor(dollars / 1000); i++;
    }
    return parts.join(' ') + ' and ' + pad2(c) + '/100 Dollars';
  }

  return { toCents: toCents, format: format, plain: plain, words: words };
})();
