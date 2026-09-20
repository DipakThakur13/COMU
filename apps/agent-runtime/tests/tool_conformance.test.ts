import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ToolContext } from "@comu/tool-core";
import { createToolRegistry } from "../src/server";

/**
 * Cancellation conformance, over every tool the runtime actually registers.
 *
 * This suite exists because six tool packages drifted apart on cancellation without anyone
 * noticing: `ToolContext` used to carry two optional mechanisms and nothing required a tool to
 * observe either, so whether Stop worked depended on who wrote the tool. The audit in
 * docs/CANCELLATION_AUDIT.md has the detail.
 *
 * It iterates `registry.getAll()` rather than a hand-written list, so a tool added later is covered
 * automatically. That is the point: conformance must not depend on remembering.
 *
 * The contract every tool must satisfy:
 *   1. An already-aborted signal is refused before any work happens.
 *   2. Refusal is unambiguous: it throws a cancellation error, or returns a result marked cancelled.
 *   3. It happens promptly, not after the tool's own timeout.
 */

const TIMEOUT_MS = 2000;

function abortedContext(rootPath: string): ToolContext {
  const controller = new AbortController();
  controller.abort();
  return {
    taskId: "conformance",
    workspace: { rootPath },
    limits: { maxResults: 10, maxBytes: 10_000, maxCommandTimeoutMs: 30_000 },
    permissions: { capabilities: { read: "ALLOW", write: "ALLOW", execute: "ALLOW", network: "ALLOW" } },
    abortSignal: controller.signal
  };
}

/**
 * Plausible arguments per tool. A conforming tool never reaches argument validation, because the
 * cancellation check comes first; these exist only so a non-conforming tool fails for the right
 * reason rather than on a missing field.
 */
function argsFor(toolName: string, rootPath: string): Record<string, unknown> {
  switch (toolName) {
    case "read_file":
      return { path: "probe.txt" };
    case "list_directory":
      return { path: "." };
    case "get_workspace_tree":
      return { dir: "." };
    case "create_file":
    case "write_file":
      return { path: "conformance-should-not-exist.txt", content: "x" };
    case "edit_file":
      return { path: "probe.txt", edits: [{ oldText: "hello", newText: "world" }] };
    case "search_text":
      return { query: "hello", pattern: "hello" };
    case "execute_command":
      return { executable: "node", args: ["--version"] };
    case "git_status":
    case "git_diff":
      return {};
    case "git_create_branch":
      return { branchName: "conformance-branch" };
    case "git_stage_files":
      return { files: ["probe.txt"] };
    case "git_commit":
      return { message: "feat(probe): conformance" };
    case "git_push":
      return { remote: "origin", branch: "main" };
    case "run_tests":
    case "run_build":
    case "run_linter":
    case "run_typecheck":
      return {};
    case "web_docs":
      return { url: "https://nodejs.org/api/fs.html" };
    default:
      return {};
  }
}

function describeOutcome(outcome: { ok: true; value: unknown } | { ok: false; error: unknown }): string {
  if (!outcome.ok) {
    const error = outcome.error as { name?: string; message?: string };
    return `threw ${error?.name ?? "Error"}: ${error?.message ?? String(outcome.error)}`;
  }
  return `returned ${JSON.stringify(outcome.value)?.slice(0, 160)}`;
}

/** A tool conforms if it throws a cancellation error, or returns a result flagged cancelled. */
function isCancellationOutcome(outcome: { ok: true; value: any } | { ok: false; error: any }): boolean {
  if (!outcome.ok) {
    const name = String(outcome.error?.name ?? "");
    const message = String(outcome.error?.message ?? outcome.error ?? "");
    return (
      name === "TaskCancelledError" ||
      name === "AbortError" ||
      /cancel/i.test(message) ||
      /abort/i.test(message)
    );
  }
  const value = outcome.value;
  if (value && typeof value === "object") {
    if (value.cancelled === true) return true;
    if (typeof value.status === "string" && value.status.toUpperCase() === "CANCELLED") return true;
  }
  return false;
}

describe("Tool cancellation conformance", () => {
  const registry = createToolRegistry();
  let workspace: string;

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "comu-conformance-"));
    fs.writeFileSync(path.join(workspace, "probe.txt"), "hello world", "utf8");
    fs.writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "probe", scripts: { test: "node --version", build: "node --version", lint: "node --version" } }),
      "utf8"
    );
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("registers the tools a task can call", () => {
    const names = registry.getAll().map(t => t.name).sort();
    expect(names.length).toBeGreaterThanOrEqual(17);
    // A spot check, so a tool silently disappearing from the registry is caught here too.
    expect(names).toEqual(expect.arrayContaining(["read_file", "write_file", "execute_command", "git_push", "web_docs", "search_text"]));
  });

  for (const tool of createToolRegistry().getAll()) {
    it(`${tool.name} refuses an already-aborted signal`, async () => {
      const started = Date.now();
      const outcome = await Promise.race([
        tool
          .execute(argsFor(tool.name, workspace) as never, abortedContext(workspace))
          .then(value => ({ ok: true as const, value }))
          .catch(error => ({ ok: false as const, error })),
        new Promise<{ ok: false; error: Error }>(resolve =>
          setTimeout(() => resolve({ ok: false, error: new Error("TOOL_DID_NOT_RETURN") }), TIMEOUT_MS)
        )
      ]);

      const elapsed = Date.now() - started;
      expect(
        isCancellationOutcome(outcome),
        `${tool.name} ignored an aborted signal and ${describeOutcome(outcome)}`
      ).toBe(true);
      expect(elapsed, `${tool.name} took ${elapsed}ms to observe cancellation`).toBeLessThan(TIMEOUT_MS);
    });
  }

  it("no tool writes to the workspace when its signal is already aborted", async () => {
    const before = fs.readdirSync(workspace).sort();
    for (const tool of registry.getAll()) {
      await tool
        .execute(argsFor(tool.name, workspace) as never, abortedContext(workspace))
        .catch(() => undefined);
    }
    expect(fs.readdirSync(workspace).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(workspace, "probe.txt"), "utf8")).toBe("hello world");
  });
});
