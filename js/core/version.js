/* =========================================================
   CB.APP_VERSION — which copy of CheckBook this is.

   The version is the release date: YEAR.MONTH.DAY (e.g. 2026.11.12).
   A second release on the same day adds -2, -3, ... (2026.11.12-2).
   When you release, change it in THREE places (a test checks they match):
     1. here
     2. package.json  "version"
     3. the top "## " heading in CHANGELOG.md
   Then name the zip and its folder CheckBook-<version>.

   This is NOT the data format version (that is CB.schema.VERSION).
   ========================================================= */
var CB = window.CB = window.CB || {};
CB.APP_VERSION = '2026.11.13';
