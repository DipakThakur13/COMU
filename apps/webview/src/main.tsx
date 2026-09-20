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
} else {
  // Standalone harness. Loaded lazily so none of it reaches the production bundle.
  void import("./dev/mount.js").then(({ mountHarness }) => mountHarness(rootElement));
}
