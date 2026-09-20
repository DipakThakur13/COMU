import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

describe("Theming discipline", () => {
  /**
   * The old interface hardcoded roughly half its colours, which is why it was only ever correct in
   * one dark theme. This guard fails the build if a component reintroduces a literal colour.
   * The harness is exempt: it exists precisely to stand in for the themes VS Code injects.
   */
  it("no component style contains a literal colour", () => {
    const styles = walk(srcRoot, f => f.endsWith(".css") && !f.includes(`${path.sep}dev${path.sep}`));
    expect(styles.length).toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const file of styles) {
      const matches = fs.readFileSync(file, "utf8").match(HEX);
      if (matches) offenders.push(`${path.relative(srcRoot, file)}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no component style contains a literal rgb()/hsl() colour either", () => {
    const styles = walk(srcRoot, f => f.endsWith(".css") && !f.includes(`${path.sep}dev${path.sep}`));
    const offenders = styles.filter(file => /\b(rgb|rgba|hsl|hsla)\s*\(/.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map(f => path.relative(srcRoot, f))).toEqual([]);
  });

  it("every semantic token resolves from a VS Code variable or another token", () => {
    const tokens = fs.readFileSync(path.join(srcRoot, "styles", "tokens.css"), "utf8");
    const declarations = [...tokens.matchAll(/(--comu-[a-z0-9-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(25);

    // Size, type and motion tokens are plain values by design; only colour tokens must derive.
    const NON_COLOUR = /^--comu-(text-(xs|sm|md|lg)|font|font-mono|line|space-\d|radius-\w+|motion-\w+|ease)$/;
    const colourish = declarations.filter(
      ([, name]) => /surface|text|border|accent|status|tint|diff|focus|hover|selected|secondary|overlay/.test(name) && !NON_COLOUR.test(name)
    );
    for (const [, name, value] of colourish) {
      const derived = value.includes("var(--vscode-") || value.includes("var(--comu-") || value.trim() === "transparent";
      expect(derived, `${name} does not resolve from a theme variable: ${value.trim()}`).toBe(true);
    }
  });

  it("components use semantic tokens, never a --vscode-* variable directly", () => {
    const styles = walk(srcRoot, f => f.endsWith(".css") && !f.includes(`${path.sep}dev${path.sep}`) && !f.endsWith("tokens.css"));
    const offenders: string[] = [];
    for (const file of styles) {
      const content = fs.readFileSync(file, "utf8");
      // A small allowlist: form controls and scrollbars have no COMU-level equivalent.
      const allowed = /--vscode-(input-|scrollbarSlider-|badge-|font-family|editor-font-family|contrastBorder)/;
      for (const match of content.matchAll(/var\((--vscode-[a-zA-Z-]+)/g)) {
        if (!allowed.test(match[1])) offenders.push(`${path.relative(srcRoot, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("high contrast removes the tinted fills that would wash out its borders", () => {
    const tokens = fs.readFileSync(path.join(srcRoot, "styles", "tokens.css"), "utf8");
    expect(tokens).toContain("body.vscode-high-contrast");
    expect(tokens).toMatch(/--comu-tint-ok:\s*transparent/);
  });

  it("motion respects prefers-reduced-motion", () => {
    const tokens = fs.readFileSync(path.join(srcRoot, "styles", "tokens.css"), "utf8");
    expect(tokens).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("no emoji is used as an icon in any component", () => {
    const sources = walk(srcRoot, f => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(`${path.sep}dev${path.sep}`));
    const offenders: string[] = [];
    for (const file of sources) {
      const content = fs.readFileSync(file, "utf8");
      if (/\p{Extended_Pictographic}/u.test(content)) offenders.push(path.relative(srcRoot, file));
    }
    expect(offenders).toEqual([]);
  });
});
