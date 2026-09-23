import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/keyframes.css";
import "./styles/global.css";
import { App } from "./App.js";
import { VsCodeApi, connectToHost } from "./store/store.js";

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("COMU webview: #root is missing from the host document.");
}

if (typeof window.acquireVsCodeApi === "function") {
  // Running inside VS Code: the extension host is the authority.
  connectToHost(window.acquireVsCodeApi());
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else if (import.meta.env.DEV) {
  /*
   * Standalone harness.
   *
   * Behind `import.meta.env.DEV`, not merely behind a dynamic import. A lazy import is still a
   * chunk in the build output, so the fixtures shipped inside the 0.3.0 .vsix as a 25 KB
   * `mount-*.js` while this comment claimed they could not. Vite folds the constant at build time
   * and the branch, with everything it reaches, is dropped from a production build.
   */
  void import("./dev/mount.js").then(({ mountHarness }) => mountHarness(rootElement));
}
