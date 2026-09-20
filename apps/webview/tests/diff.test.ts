import { describe, it, expect } from "vitest";
import { languageForPath, numberLines, parseUnifiedDiff } from "../src/components/diff/parse.js";

const NL = String.fromCharCode(10);

const PATCH = [
  "Index: src/a.ts",
  "===================================================================",
  "--- src/a.ts\toriginal",
  "+++ src/a.ts\tmodified",
  "@@ -1,5 +1,6 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a };",
  "@@ -20,2 +21,2 @@",
  "-old tail",
  "+new tail"
].join(NL);

describe("parseUnifiedDiff", () => {
  it("splits hunks and counts additions and deletions", () => {
    const parsed = parseUnifiedDiff(PATCH);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.additions).toBe(3);
    expect(parsed.deletions).toBe(2);
    expect(parsed.hunks[0].header).toBe("@@ -1,5 +1,6 @@");
    expect(parsed.hunks[1].oldStart).toBe(20);
    expect(parsed.hunks[1].newStart).toBe(21);
  });

  it("drops the file header, which the card shows separately", () => {
    const parsed = parseUnifiedDiff(PATCH);
    const text = parsed.hunks.flatMap(h => h.lines.map(l => l.text)).join(NL);
    expect(text).not.toContain("Index:");
    expect(text).not.toContain("+++");
  });

  it("numbers both sides so a reviewer can find the line in the file", () => {
    const [first] = parseUnifiedDiff(PATCH).hunks;
    expect(first.lines[0]).toMatchObject({ kind: "context", text: "const a = 1;", oldLine: 1, newLine: 1 });
    expect(first.lines[1]).toMatchObject({ kind: "del", text: "const b = 2;", oldLine: 2 });
    expect(first.lines[1].newLine).toBeUndefined();
    expect(first.lines[2]).toMatchObject({ kind: "add", text: "const b = 3;", newLine: 2 });
    expect(first.lines[2].oldLine).toBeUndefined();
    expect(first.lines[4]).toMatchObject({ kind: "context", oldLine: 3, newLine: 4 });
  });

  it("marks a missing trailing newline as metadata, not as content", () => {
    const parsed = parseUnifiedDiff(["@@ -1,1 +1,1 @@", "-a", "+b", "\\ No newline at end of file"].join(NL));
    const meta = parsed.hunks[0].lines.filter(l => l.kind === "meta");
    expect(meta).toHaveLength(1);
    expect(meta[0].text).toBe("No newline at end of file");
    expect(parsed.additions).toBe(1);
  });

  it("returns nothing rather than throwing on empty or malformed input", () => {
    expect(parseUnifiedDiff("").hunks).toEqual([]);
    expect(parseUnifiedDiff("not a diff at all").hunks).toEqual([]);
    expect(parseUnifiedDiff(undefined as unknown as string).hunks).toEqual([]);
  });
});

describe("numberLines", () => {
  it("numbers a new file's content and ignores the trailing newline", () => {
    const lines = numberLines(`a${NL}b${NL}`);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ kind: "add", text: "b", newLine: 2 });
  });

  it("keeps a genuinely blank final line when there is no trailing newline", () => {
    expect(numberLines(`a${NL}${NL}b`)).toHaveLength(3);
  });
});

describe("languageForPath", () => {
  it("maps the extensions COMU actually encounters", () => {
    expect(languageForPath("src/a.ts")).toBe("typescript");
    expect(languageForPath("src/a.tsx")).toBe("typescript");
    expect(languageForPath("main.py")).toBe("python");
    expect(languageForPath("go.mod")).toBeUndefined();
    expect(languageForPath("main.go")).toBe("go");
    expect(languageForPath("a/b/style.scss")).toBe("scss");
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("Makefile")).toBe("makefile");
  });

  it("returns undefined for an unknown language rather than guessing a grammar", () => {
    expect(languageForPath("data.bin")).toBeUndefined();
    expect(languageForPath("LICENSE")).toBeUndefined();
    expect(languageForPath("")).toBeUndefined();
  });
});
