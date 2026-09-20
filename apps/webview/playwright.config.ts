import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression over the harness.
 *
 * The defect class that started the interface rebuild — hardcoded colours, mid-word wrapping,
 * controls that overflow a narrow panel — is invisible to unit tests and to typecheck. Only a
 * picture catches it. The harness already takes fixture, theme and width as query parameters, so
 * it is the test matrix.
 *
 * Snapshots are per-platform (Playwright suffixes them with the OS), because system font rendering
 * differs. A new platform generates its own baselines with `pnpm test:visual:update`.
 */
export default defineConfig({
  testDir: "./tests/visual",
  snapshotDir: "./tests/visual/__screenshots__",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,

  expect: {
    toHaveScreenshot: {
      // A small tolerance absorbs sub-pixel text antialiasing without hiding a layout change.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide"
    }
  },

  use: {
    baseURL: "http://127.0.0.1:3100",
    // Motion off, so a spinner frame or a blinking caret can never be the diff.
    reducedMotion: "reduce",
    colorScheme: "dark",
    deviceScaleFactor: 1,
    trace: "retain-on-failure"
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
    }
  ],

  webServer: {
    command: "npx vite --port 3100 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe"
  }
});
