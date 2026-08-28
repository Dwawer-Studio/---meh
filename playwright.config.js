'use strict';

const { defineConfig } = require('@playwright/test');

const port = Number.parseInt(process.env.MEH_E2E_PORT || '4174', 10);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: 'line',
    use: {
        baseURL,
        browserName: 'chromium',
        locale: 'ar-BH',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
