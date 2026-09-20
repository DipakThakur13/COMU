/**
 * Unified diff parsing.
 *
 * Pure and separately tested, because the approval card's whole value is that the diff it shows is
 * the diff that will land. The input is whatever `jsdiff`'s createPatch produced on the host side.
 */

export type DiffLineKind = "context" | "add" | "del" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content with the leading marker removed. */
  text: string;
  /** 1-based line number in the original file; absent for additions. */
  oldLine?: number;
  /** 1-based line number in the proposed file; absent for deletions. */
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;

  for (const raw of String(diff ?? "").split("\n")) {
    const hunkMatch = HUNK.exec(raw);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      current = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(current);
      continue;
    }

    // Everything before the first hunk is the file header, which the card shows separately.
    if (!current) continue;

    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", text: raw.slice(1), newLine });
      newLine += 1;
      additions += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", text: raw.slice(1), oldLine });
      oldLine += 1;
      deletions += 1;
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file": informational, not part of either side.
      current.lines.push({ kind: "meta", text: raw.slice(1).trim() });
    } else {
      current.lines.push({ kind: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { hunks, additions, deletions };
}

/** Splits file content into numbered lines for the new-file view. */
export function numberLines(content: string): DiffLine[] {
  const lines = String(content ?? "").split("\n");
  // A trailing newline produces an empty final element that is not a real line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((text, index) => ({ kind: "add" as const, text, newLine: index + 1 }));
}

/**
 * Maps a file extension to a highlight.js language id. Anything unrecognised returns undefined and
 * renders as plain text rather than guessing a grammar and colouring it wrongly.
 */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  html: "xml",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  dockerfile: "dockerfile"
};

export function languageForPath(filePath: string): string | undefined {
  const name = String(filePath ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  if (/^dockerfile$/i.test(name)) return "dockerfile";
  if (/^makefile$/i.test(name)) return "makefile";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGES[extension];
}
