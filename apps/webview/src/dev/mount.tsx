import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../App.js";
import { HarnessControls, HarnessHost, installHarness } from "./harness.js";
import { applyHarnessTheme, ThemeId } from "./themes.js";
import styles from "./harness.module.css";

/**
 * Harness entry. Renders the real App inside a resizable panel-sized frame next to the controls,
 * so what is reviewed here is exactly what ships, at the width it actually runs at.
 */
function Harness({ host }: { host: HarnessHost }) {
  const width = useMemo(() => new URLSearchParams(window.location.search).get("width") ?? "340", []);
  return (
    <div className={styles.layout}>
      <div id="comu-harness-frame" className={styles.frame} style={{ width: width === "full" ? "100%" : `${width}px` }}>
        <App />
      </div>
      <div>
        <h1 className={styles.title}>COMU interface harness</h1>
        <HarnessControls host={host} />
      </div>
    </div>
  );
}

export function mountHarness(rootElement: HTMLElement) {
  const params = new URLSearchParams(window.location.search);
  applyHarnessTheme((params.get("theme") as ThemeId) ?? "dark");

  const { host } = installHarness({
    fixtureId: params.get("fixture") ?? "running",
    speed: Number(params.get("speed") ?? 120)
  });

  createRoot(rootElement).render(
    <StrictMode>
      <Harness host={host} />
    </StrictMode>
  );
}
