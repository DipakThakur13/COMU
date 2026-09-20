import { useState } from "react";
import { Button } from "../primitives/index.js";
import styles from "./activity.module.css";

/**
 * Splits an assistant message into prose and fenced code blocks.
 *
 * Deliberately not a markdown renderer. A model's reply is untrusted text, and the value here is
 * narrow and specific: a code block the user can copy or save without selecting it by hand. Bold
 * and headings do not earn the parser, and rendering arbitrary markdown from a model into the
 * panel is a larger decision than this component should make.
 */
export interface Segment {
  kind: "text" | "code";
  content: string;
  language?: string;
}

const FENCE = /^```([A-Za-z0-9+#._-]*)[ \t]*$/;

export function parseMessage(text: string): Segment[] {
  const lines = String(text ?? "").split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let language: string | undefined;

  const flush = (kind: Segment["kind"]) => {
    const content = buffer.join("\n");
    // Prose is dropped when blank; an empty code block is still a code block the model wrote.
    if (kind === "code" || content.trim().length > 0) {
      segments.push(kind === "code" ? { kind, content, language } : { kind, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence) {
      if (inCode) {
        flush("code");
        inCode = false;
        language = undefined;
      } else {
        flush("text");
        inCode = true;
        language = fence[1] || undefined;
      }
      continue;
    }
    buffer.push(line);
  }

  // An unterminated fence is common while a reply is still streaming: show it as code anyway.
  flush(inCode ? "code" : "text");
  return segments;
}

const EXTENSIONS: Record<string, string> = {
  typescript: "ts", ts: "ts", tsx: "tsx",
  javascript: "js", js: "js", jsx: "jsx",
  python: "py", py: "py",
  json: "json", yaml: "yml", yml: "yml",
  html: "html", css: "css", scss: "scss",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh",
  rust: "rs", go: "go", java: "java", kotlin: "kt",
  ruby: "rb", php: "php", sql: "sql",
  markdown: "md", md: "md", toml: "toml", xml: "xml"
};

/** A filename the host's save dialog can start from. Never a path, so it cannot escape anywhere. */
export function suggestedFilename(language: string | undefined, index: number): string {
  const ext = EXTENSIONS[String(language ?? "").toLowerCase()] ?? "txt";
  return `comu-snippet-${index + 1}.${ext}`;
}

export interface MessageTextProps {
  text: string;
  onSaveCode?: (content: string, suggestedPath: string) => void;
}

export function MessageText({ text, onSaveCode }: MessageTextProps) {
  const segments = parseMessage(text);
  let codeIndex = -1;

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "text") {
          return (
            <span key={i} className={styles.messageProse}>
              {segment.content}
            </span>
          );
        }
        codeIndex += 1;
        return (
          <CodeBlock
            key={i}
            segment={segment}
            filename={suggestedFilename(segment.language, codeIndex)}
            onSaveCode={onSaveCode}
          />
        );
      })}
    </>
  );
}

function CodeBlock({
  segment,
  filename,
  onSaveCode
}: {
  segment: Segment;
  filename: string;
  onSaveCode?: (content: string, suggestedPath: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Clipboard access can be refused; saying nothing would look like the button did nothing.
    void navigator.clipboard
      ?.writeText(segment.content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <span className={styles.codeBlock}>
      <span className={styles.codeHead}>
        <span className={styles.codeLang}>{segment.language ?? "text"}</span>
        <Button variant="ghost" small onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </Button>
        {onSaveCode ? (
          <Button variant="ghost" small onClick={() => onSaveCode(segment.content, filename)}>
            Save as…
          </Button>
        ) : null}
      </span>
      <pre className={styles.codePre}>
        <code>{segment.content}</code>
      </pre>
    </span>
  );
}
