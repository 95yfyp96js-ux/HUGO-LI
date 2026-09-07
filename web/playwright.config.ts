import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Use a preinstalled Chromium when one is present (CI images often ship a
 * browser whose build number does not match this Playwright release), and
 * otherwise fall back to Playwright's own managed download.
 */
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = {
  ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
  // Containers commonly run the suite as root, where Chromium's sandbox
  // refuses to start.
  ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    {
      // iPhone-sized viewport, but driven by Chromium: this image ships no
      // WebKit build, and the responsive layout is what we are testing.
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        launchOptions,
      },
    },
  ],
});
