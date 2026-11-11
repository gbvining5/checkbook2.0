// Settings for the end-to-end tests in tests/e2e.spec.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  use: {
    viewport: { width: 1366, height: 768 },
    browserName: 'chromium',
    // Optional: point at an installed Chrome instead of downloading one, e.g. CHROME_PATH=/usr/bin/google-chrome
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  },
  reporter: [['list']]
});
