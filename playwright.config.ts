import { defineConfig, devices } from "@playwright/test";

// Playwright config for UdL end-to-end tests. Targets the Vite dev server; reuses
// one already running, otherwise starts it on port 5210.
export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://localhost:5210",
        headless: true,
        viewport: { width: 1440, height: 900 },
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        command: "npm run dev:web -- --port 5210",
        url: "http://localhost:5210",
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
