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
      /*
       * No changed pixel is acceptable, and none is needed.
       *
       * This used to be `maxDiffPixelRatio: 0.01`, which sounds strict and is not: the panel is
       * 400x840, so one percent is 3,360 pixels, and at 900px wide it is 7,560. Measured against
       * this suite, renaming the status pill from "Completed" to "Finished" changes 144 pixels and
       * altering the separators on the header's second line changes 31 to 290. Every one of those
       * fits inside the old ceiling, which is how a rewritten header line was absorbed silently
       * while the suite reported 163 passing.
       *
       * Zero is achievable because every source of variation is held still rather than tolerated:
       * the clock is fixed (`setFixedTime`, not `install`, which still advances), animations are
       * disabled, the caret is hidden, motion is reduced, and the device scale is pinned. Three
       * consecutive runs produce byte-identical renders.
       *
       * If a future renderer introduces genuine sub-pixel noise, find what varies and freeze it,
       * or `mask` that one element in the assertion that needs it. Do not raise this number: a
       * ceiling in pixels is a budget for changes nobody will see, and the changes that matter
       * here are of exactly that size.
       */
      maxDiffPixels: 0,
      // Per-pixel colour distance before a pixel counts as different at all. Absorbs a rounding
      // difference in a blended colour without absorbing a glyph.
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
