import { Fragment, useEffect, useMemo, useState } from "react";
import { DiffHunk, DiffLine, languageForPath, numberLines, parseUnifiedDiff } from "./parse.js";
import styles from "./diff.module.css";

/** Lazily loaded so the highlighter never costs anything until a diff is actually shown. */
type Highlighter = (code: string, language: string) => string;

let highlighterPromise: Promise<Highlighter | undefined> | undefined;

async function loadHighlighter(): Promise<Highlighter | undefined> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const hljs = (await import("highlight.js/lib/common")).default;
        return (code: string, language: string) => {
          if (!hljs.getLanguage(language)) return "";
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        };
      } catch {
        // Highlighting is a bonus. A failed import must never cost the diff itself.
        return undefined;
      }
    })();
  }
  return highlighterPromise;
}

function LineRow({ line, html }: { line: DiffLine; html?: string }) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : line.kind === "meta" ? "" : " ";
  return (
    <tr className={styles[line.kind]}>
      <td className={styles.gutter} aria-hidden="true">
        {line.oldLine ?? ""}
      </td>
      <td className={styles.gutter} aria-hidden="true">
        {line.newLine ?? ""}
      </td>
      <td className={styles.marker} aria-hidden="true">
        {marker}
      </td>
      <td className={styles.code}>
        {html !== undefined ? <span dangerouslySetInnerHTML={{ __html: html }} /> : line.text || " "}
      </td>
    </tr>
  );
}

export interface DiffViewProps {
  path: string;
  diff: string;
  /** Present for a created file: the content is shown instead of a diff against nothing. */
  content?: string;
  operation: "CREATE" | "MODIFY";
  truncated?: boolean;
  maxHeight?: number;
}

/**
 * Renders a proposed change.
 *
 * Addition and deletion colouring comes from the parse and the token layer, so a diff is fully
 * readable before (and without) the highlighter. Syntax highlighting is layered on after a dynamic
 * import; an unknown language stays plain text rather than being coloured by a guessed grammar.
 */
export function DiffView({ path, diff, content, operation, truncated, maxHeight = 320 }: DiffViewProps) {
  const language = useMemo(() => languageForPath(path), [path]);
  const isNewFile = operation === "CREATE" && typeof content === "string";

  const hunks: DiffHunk[] = useMemo(() => {
    if (isNewFile) {
      return [{ header: "", oldStart: 0, newStart: 1, lines: numberLines(content as string) }];
    }
    return parseUnifiedDiff(diff).hunks;
  }, [isNewFile, content, diff]);

  const [highlighted, setHighlighted] = useState<Map<string, string>>();

  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    void loadHighlighter().then(highlight => {
      if (cancelled || !highlight) return;
      const map = new Map<string, string>();
      for (const hunk of hunks) {
        for (const line of hunk.lines) {
          if (line.kind === "meta" || map.has(line.text)) continue;
          const html = highlight(line.text, language);
          if (html) map.set(line.text, html);
        }
      }
      if (!cancelled && map.size > 0) setHighlighted(map);
    });
    return () => {
      cancelled = true;
    };
  }, [language, hunks]);

  if (hunks.length === 0) {
    return <p className={styles.empty}>No textual change to show.</p>;
  }

  return (
    <div className={styles.wrapper}>
      {isNewFile ? (
        <p className={styles.newFileLabel}>
          New file, {hunks[0].lines.length} {hunks[0].lines.length === 1 ? "line" : "lines"}
        </p>
      ) : null}
      <div className={styles.scroll} style={{ maxHeight }} tabIndex={0} role="group" aria-label={`Proposed change to ${path}`}>
        <table className={styles.table}>
          <tbody>
            {hunks.map((hunk, index) => (
              // A keyed Fragment: a bare <> in a list has no key, so React cannot tell hunks apart
              // and re-creates rows it should have reused.
              <Fragment key={index}>
                {hunk.header ? (
                  <tr className={styles.hunk}>
                    <td className={styles.gutter} colSpan={3} aria-hidden="true" />
                    <td className={styles.code}>{hunk.header}</td>
                  </tr>
                ) : null}
                {hunk.lines.map((line, lineIndex) => (
                  <LineRow key={`${index}-${lineIndex}`} line={line} html={highlighted?.get(line.text)} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? <p className={styles.truncated}>This change is large; the preview is truncated.</p> : null}
    </div>
  );
}
