import { test, expect, Page } from "@playwright/test";

/**
 * Visual regression over the full harness matrix.
 *
 * Every fixture, in each theme family, at each panel width. This is the only check that can see
 * the defect class the rebuild exists to fix: a colour that does not follow the theme, a control
 * that overflows a narrow panel, a word broken in half. None of it is visible to typecheck, lint
 * or a DOM assertion.
 */

const FIXTURES = [
  "idle",
  "running",
  "approval",
  "approval-create",
  "approval-command",
  "approval-push",
  "completed",
  "chat",
  "changes",
  "failed",
  "settings",
  "long",
  "thread",
  "drawer-overview",
  "drawer-verification",
  "drawer-workers",
  "drawer-memory"
] as const;

/**
 * The drawer fixtures are one event fixture viewed with a different surface open, so they share a
 * fixture id and differ only in which drawer tab is expanded.
 */
const DRAWER: Partial<Record<(typeof FIXTURES)[number], string>> = {
  "drawer-overview": "overview",
  "drawer-verification": "verification",
  "drawer-workers": "workers",
  "drawer-memory": "memory"
};

/** The Changes fixture is only meaningful with that surface selected. */
const SURFACE: Partial<Record<(typeof FIXTURES)[number], string>> = { changes: "changes" };

/** Settings is a full-panel view rather than an event fixture. */
const SETTINGS = new Set<string>(["settings"]);
const THEMES = ["dark", "light", "hc-dark"] as const;
const WIDTHS = [280, 400, 900] as const;

/**
 * Fixed so the elapsed clock and any date formatting are the same on every run.
 *
 * `setFixedTime`, not `install`: an installed clock still advances, so the elapsed seconds in the
 * header and the live status line rendered a second or two apart between runs. That was the whole
 * of the measured run-to-run noise, and it is the reason the tolerance used to need to be loose.
 */
const FROZEN_NOW = new Date("2026-09-20T10:04:30.000Z");

async function openPanel(page: Page, fixture: string, theme: string, width: number) {
  await page.clock.setFixedTime(FROZEN_NOW);
  const surface = SURFACE[fixture as (typeof FIXTURES)[number]];
  // speed=0 delivers the whole fixture at once: no paced replay, nothing in flight.
  const settings = SETTINGS.has(fixture) ? "&settings=1" : "";
  const drawer = DRAWER[fixture as (typeof FIXTURES)[number]];
  const fixtureId = SETTINGS.has(fixture) ? "idle" : drawer ? "drawer" : fixture;
  await page.goto(`/?fixture=${fixtureId}&theme=${theme}&width=${width}&speed=0${surface ? `&surface=${surface}` : ""}${drawer ? `&drawer=${drawer}` : ""}${settings}`);
  await page.waitForSelector("body[data-comu-harness-settled='1']");
  await page.waitForFunction(() => document.fonts.status === "loaded");
  const frame = page.locator("#comu-harness-frame");
  await expect(frame).toBeVisible();
  return frame;
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`${theme} @ ${width}px`, () => {
      for (const fixture of FIXTURES) {
        test(`${fixture}`, async ({ page }) => {
          const frame = await openPanel(page, fixture, theme, width);
          await expect(frame).toHaveScreenshot(`${fixture}-${theme}-${width}.png`);
        });
      }
    });
  }
}

test.describe("layout invariants", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture} never scrolls horizontally at 280px`, async ({ page }) => {
      await openPanel(page, fixture, "dark", 280);
      // A horizontal scrollbar at the narrowest supported width is a layout defect, not a taste call.
      const result = await page.evaluate(() => {
        const frame = document.getElementById("comu-harness-frame");
        if (!frame) return { panelScrolls: false, pushers: [] as string[] };
        const pushers = [...frame.querySelectorAll<HTMLElement>("*")]
          .filter(el => {
            const style = getComputedStyle(el);
            // Only overflow-visible content actually pushes the layout wider. A scroller is meant to
            // scroll, a clipped element is ellipsised on purpose, and 1px boxes are reader-only text.
            if (style.overflowX !== "visible") return false;
            if (el.clientWidth <= 1 || el.clientHeight <= 1) return false;
            return el.scrollWidth > el.clientWidth + 1;
          })
          .map(el => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
        return { panelScrolls: frame.scrollWidth > frame.clientWidth + 1, pushers };
      });
      expect(result.pushers).toEqual([]);
      expect(result.panelScrolls).toBe(false);
    });
  }

  test("provider names and tags never break mid-word at 280px", async ({ page }) => {
    await openPanel(page, "settings", "dark", 280);
    const offenders = await page.evaluate(() => {
      const frame = document.getElementById("comu-harness-frame");
      if (!frame) return [];
      const bad: string[] = [];
      for (const el of frame.querySelectorAll<HTMLElement>("h2, h3, span, label, button")) {
        const style = getComputedStyle(el);
        if (style.overflowWrap === "anywhere" || style.wordBreak === "break-all") {
          bad.push(`${el.tagName.toLowerCase()}: ${el.textContent?.slice(0, 40)}`);
        }
      }
      return bad;
    });
    // A provider message may contain a URL; nothing else in settings may break inside a word.
    expect(offenders.filter(o => !/Reachable|Could not connect/.test(o))).toEqual([]);
  });

  test("no text is broken mid-word at 280px", async ({ page }) => {
    await openPanel(page, "approval", "dark", 280);
    // overflow-wrap: anywhere is only acceptable on content we cannot control (paths, diffs).
    // Labels and status text must never use it.
    const offenders = await page.evaluate(() => {
      const frame = document.getElementById("comu-harness-frame");
      if (!frame) return [];
      const out: string[] = [];
      for (const el of frame.querySelectorAll<HTMLElement>("button, select, label, h1, h2, h3")) {
        const style = getComputedStyle(el);
        if (style.overflowWrap === "anywhere" || style.wordBreak === "break-all") {
          out.push(`${el.tagName.toLowerCase()}: ${el.textContent?.slice(0, 40)}`);
        }
      }
      return out;
    });
    expect(offenders).toEqual([]);
  });

  test("the panel carries no shipped debug bar", async ({ page }) => {
    await openPanel(page, "running", "dark", 400);
    const text = (await page.locator("#comu-harness-frame").innerText()).toLowerCase();
    expect(text).not.toContain("comu boot");
    expect(text).not.toContain("html ✓");
  });
});
