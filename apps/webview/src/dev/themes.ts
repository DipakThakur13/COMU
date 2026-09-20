/**
 * Theme variable sets for the standalone harness.
 *
 * At runtime VS Code injects the real --vscode-* variables for whatever theme the user has. These
 * are approximations of the three built-in families, present only so the interface can be checked
 * in light, dark and high contrast without launching an extension host. Getting this wrong is the
 * old interface's largest silent defect, so it is testable here by default.
 */

export type ThemeId = "dark" | "light" | "hc-dark" | "hc-light";

export interface HarnessTheme {
  id: ThemeId;
  label: string;
  /** Matches the class VS Code puts on <body>, which the token layer keys off. */
  bodyClass: string;
  vars: Record<string, string>;
}

const dark: Record<string, string> = {
  "--vscode-editor-background": "#1f1f1f",
  "--vscode-sideBar-background": "#181818",
  "--vscode-foreground": "#cccccc",
  "--vscode-descriptionForeground": "#9d9d9d",
  "--vscode-panel-border": "#2b2b2b",
  "--vscode-focusBorder": "#0078d4",
  "--vscode-button-background": "#0078d4",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#026ec1",
  "--vscode-button-secondaryBackground": "#313131",
  "--vscode-button-secondaryForeground": "#cccccc",
  "--vscode-button-secondaryHoverBackground": "#3c3c3c",
  "--vscode-input-background": "#313131",
  "--vscode-input-foreground": "#cccccc",
  "--vscode-input-border": "#3c3c3c",
  "--vscode-list-hoverBackground": "#2a2d2e",
  "--vscode-list-activeSelectionBackground": "#04395e",
  "--vscode-textLink-foreground": "#4daafc",
  "--vscode-textCodeBlock-background": "#0a0a0a",
  "--vscode-errorForeground": "#f85149",
  "--vscode-editorWarning-foreground": "#cca700",
  "--vscode-testing-iconPassed": "#3fb950",
  "--vscode-gitDecoration-addedResourceForeground": "#3fb950",
  "--vscode-gitDecoration-deletedResourceForeground": "#f85149",
  "--vscode-progressBar-background": "#0078d4",
  "--vscode-badge-background": "#616161",
  "--vscode-badge-foreground": "#f8f8f8",
  "--vscode-scrollbarSlider-background": "#4f4f4f66",
  "--vscode-scrollbarSlider-hoverBackground": "#646464b3",
  "--vscode-charts-blue": "#4daafc",
  "--vscode-charts-green": "#3fb950",
  "--vscode-charts-yellow": "#cca700",
  "--vscode-charts-red": "#f85149",
  "--vscode-charts-purple": "#b180d7",
  "--vscode-font-family": "system-ui, 'Segoe UI', sans-serif",
  "--vscode-editor-font-family": "'Cascadia Mono', Consolas, monospace"
};

const light: Record<string, string> = {
  "--vscode-editor-background": "#ffffff",
  "--vscode-sideBar-background": "#f8f8f8",
  "--vscode-foreground": "#3b3b3b",
  "--vscode-descriptionForeground": "#5f6368",
  "--vscode-panel-border": "#e5e5e5",
  "--vscode-focusBorder": "#005fb8",
  "--vscode-button-background": "#005fb8",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#0258a8",
  "--vscode-button-secondaryBackground": "#e5e5e5",
  "--vscode-button-secondaryForeground": "#3b3b3b",
  "--vscode-button-secondaryHoverBackground": "#cccccc",
  "--vscode-input-background": "#ffffff",
  "--vscode-input-foreground": "#3b3b3b",
  "--vscode-input-border": "#cecece",
  "--vscode-list-hoverBackground": "#f2f2f2",
  "--vscode-list-activeSelectionBackground": "#e4e6f1",
  "--vscode-textLink-foreground": "#005fb8",
  "--vscode-textCodeBlock-background": "#f2f2f2",
  "--vscode-errorForeground": "#cd3131",
  "--vscode-editorWarning-foreground": "#bf8803",
  "--vscode-testing-iconPassed": "#1a7f37",
  "--vscode-gitDecoration-addedResourceForeground": "#1a7f37",
  "--vscode-gitDecoration-deletedResourceForeground": "#cd3131",
  "--vscode-progressBar-background": "#005fb8",
  "--vscode-badge-background": "#cccccc",
  "--vscode-badge-foreground": "#3b3b3b",
  "--vscode-scrollbarSlider-background": "#64646466",
  "--vscode-scrollbarSlider-hoverBackground": "#646464b3",
  "--vscode-charts-blue": "#005fb8",
  "--vscode-charts-green": "#1a7f37",
  "--vscode-charts-yellow": "#bf8803",
  "--vscode-charts-red": "#cd3131",
  "--vscode-charts-purple": "#652d90",
  "--vscode-font-family": "system-ui, 'Segoe UI', sans-serif",
  "--vscode-editor-font-family": "'Cascadia Mono', Consolas, monospace"
};

const hcDark: Record<string, string> = {
  ...dark,
  "--vscode-editor-background": "#000000",
  "--vscode-sideBar-background": "#000000",
  "--vscode-foreground": "#ffffff",
  "--vscode-descriptionForeground": "#ffffff",
  "--vscode-contrastBorder": "#6fc3df",
  "--vscode-panel-border": "#6fc3df",
  "--vscode-focusBorder": "#f38518",
  "--vscode-button-background": "#000000",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-secondaryBackground": "#000000",
  "--vscode-input-background": "#000000",
  "--vscode-textCodeBlock-background": "#000000",
  "--vscode-list-hoverBackground": "#000000",
  "--vscode-errorForeground": "#f48771",
  "--vscode-testing-iconPassed": "#89d185"
};

const hcLight: Record<string, string> = {
  ...light,
  "--vscode-editor-background": "#ffffff",
  "--vscode-sideBar-background": "#ffffff",
  "--vscode-foreground": "#000000",
  "--vscode-descriptionForeground": "#000000",
  "--vscode-contrastBorder": "#0f4a85",
  "--vscode-panel-border": "#0f4a85",
  "--vscode-focusBorder": "#0f4a85",
  "--vscode-textCodeBlock-background": "#ffffff",
  "--vscode-list-hoverBackground": "#ffffff"
};

export const HARNESS_THEMES: HarnessTheme[] = [
  { id: "dark", label: "Dark", bodyClass: "vscode-dark", vars: dark },
  { id: "light", label: "Light", bodyClass: "vscode-light", vars: light },
  { id: "hc-dark", label: "High contrast dark", bodyClass: "vscode-high-contrast", vars: hcDark },
  { id: "hc-light", label: "High contrast light", bodyClass: "vscode-high-contrast-light", vars: hcLight }
];

export function applyHarnessTheme(id: ThemeId) {
  const theme = HARNESS_THEMES.find(t => t.id === id) ?? HARNESS_THEMES[0];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) {
    root.style.setProperty(name, value);
  }
  document.body.className = theme.bodyClass;
}
