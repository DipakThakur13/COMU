// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { AgentEvent, ProviderConfig } from "@comu/protocol";
import { createInitialSessionState, reduceEvent, type WebviewToHostMessage } from "@comu/ui-state";
import { useStore, setVsCodeApi } from "../src/store/store.js";
import { ChangesPanel } from "../src/components/changes/ChangesPanel.js";
import { ContextPanel } from "../src/components/drawer/ContextPanel.js";
import { Onboarding } from "../src/components/Onboarding.js";
import { SettingsView } from "../src/components/settings/SettingsView.js";
import { MessageText, parseMessage, suggestedFilename } from "../src/components/activity/MessageText.js";

/**
 * Parity with the interface being deleted.
 *
 * Each test here stands for a capability the old panel had. They exist so that removing
 * index.html, main.js and style.css is a replacement rather than a quiet loss of function, and so
 * that a later refactor cannot drop one of them without saying so.
 */

afterEach(() => cleanup());

let sent: WebviewToHostMessage[] = [];

beforeEach(() => {
  sent = [];
  setVsCodeApi({ postMessage: m => sent.push(m), getState: () => undefined, setState: () => undefined });
  useStore.setState({
    session: createInitialSessionState(),
    providers: [],
    providerTests: {},
    testingProvider: undefined,
    settingsTarget: undefined,
    autonomyTouched: false,
    banner: undefined,
    ui: {
      surface: "activity",
      settingsOpen: false,
      composer: { text: "", mode: "AUTO", autonomy: "ask" },
      expandedActivityIds: [],
      showElided: false
    }
  });
});

const cloud: ProviderConfig = {
  providerId: "experiential",
  displayName: "GPT-6 Astra (Experiential Labs)",
  endpoint: "https://api.experientiallabs.ai/v1",
  enabled: true,
  hasCredential: false,
  isLocal: false,
  status: "NOT_CONFIGURED",
  models: [{ id: "gpt-6-astra", name: "GPT-6 Astra" }]
};

const ollama: ProviderConfig = {
  providerId: "ollama",
  displayName: "Ollama (Local)",
  endpoint: "http://127.0.0.1:11434",
  enabled: true,
  hasCredential: true,
  isLocal: true,
  status: "CONNECTED",
  models: [{ id: "ollama:qwen2.5-coder", name: "Qwen 2.5 Coder" }]
};

describe("Autonomy: a deliberate choice outlives the configured default", () => {
  it("adopts the host default before the user has chosen", () => {
    useStore.getState().applyHostMessage({ type: "settings_update", defaultAutonomy: "auto" });
    expect(useStore.getState().ui.composer.autonomy).toBe("auto");
  });

  it("does not let a later settings push overwrite what the user picked", () => {
    // The old panel got this right and it is the one regression that would quietly widen what
    // COMU may do without asking.
    useStore.getState().setAutonomy("readonly");
    useStore.getState().applyHostMessage({ type: "settings_update", defaultAutonomy: "auto" });
    expect(useStore.getState().ui.composer.autonomy).toBe("readonly");
  });

  it("tells the host when the user changes it, so the choice is not panel-local", () => {
    useStore.getState().setAutonomy("auto");
    expect(sent).toContainEqual({ type: "set_autonomy", autonomy: "auto" });
  });
});

describe("Messages the host expects to receive", () => {
  it("asks for a fresh provider catalogue whenever settings opens", () => {
    useStore.getState().setSettingsOpen(true);
    expect(sent).toContainEqual({ type: "request_providers" });
  });

  it("asks again when the host itself deep-links into settings", () => {
    useStore.getState().applyHostMessage({ type: "open_settings", targetProviderId: "ollama" });
    expect(sent).toContainEqual({ type: "request_providers" });
    expect(useStore.getState().settingsTarget).toBe("ollama");
    expect(useStore.getState().ui.settingsOpen).toBe(true);
  });

  it("reports startup timings, rounded, as the old panel did", () => {
    useStore.getState().reportTelemetry("firstPaintMs", 12.7);
    expect(sent).toContainEqual({ type: "telemetry_metric", name: "firstPaintMs", value: 13, details: undefined });
  });

  it("offers a code block to the host to save", () => {
    useStore.getState().saveCode("const a = 1;", "comu-snippet-1.ts");
    expect(sent).toContainEqual({ type: "save_code", content: "const a = 1;", suggestedPath: "comu-snippet-1.ts" });
  });

  it("opens every changed file on request, one message per file", () => {
    useStore.setState({
      session: {
        ...createInitialSessionState(),
        changes: [
          { path: "src/a.ts", operation: "MODIFY" },
          { path: "src/b.ts", operation: "CREATE" }
        ]
      }
    });
    useStore.getState().openAllChangedFiles();
    expect(sent).toEqual([
      { type: "open_file", path: "src/a.ts" },
      { type: "open_file", path: "src/b.ts" }
    ]);
  });
});

describe("Working set", () => {
  function reduceAll(events: AgentEvent[]) {
    let state = createInitialSessionState();
    for (const event of events) state = reduceEvent(state, event);
    return state;
  }

  const e = (type: string, extra: Record<string, unknown>, id: string): AgentEvent =>
    ({ type, eventId: id, taskId: "t", timestamp: "2026-09-20T10:00:00.000Z", ...extra }) as AgentEvent;

  it("records what was read, newest first and without repeats", () => {
    const state = reduceAll([
      e("tool.completed", { tool: "read_file", path: "src/a.ts" }, "1"),
      e("tool.completed", { tool: "read_file", path: "src/b.ts" }, "2"),
      e("tool.completed", { tool: "read_file", path: "src/a.ts" }, "3")
    ]);
    expect(state.workingSet.inspectedFiles).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("finds the path wherever the tool put it", () => {
    const state = reduceAll([
      e("tool.started", { tool: "read_file", filePath: "src/x.ts" }, "1"),
      e("tool.completed", { tool: "read_file", result: { path: "src/y.ts" } }, "2")
    ]);
    expect(state.workingSet.inspectedFiles).toEqual(["src/y.ts", "src/x.ts"]);
  });

  it("bounds the read list, because it answers what COMU is on now", () => {
    const state = reduceAll(
      Array.from({ length: 40 }, (_, i) => e("tool.completed", { tool: "read_file", path: `src/f${i}.ts` }, `e${i}`))
    );
    expect(state.workingSet.inspectedFiles).toHaveLength(20);
    expect(state.workingSet.inspectedFiles[0]).toBe("src/f39.ts");
  });

  it("records every written file, unbounded, because each is a change to review", () => {
    const state = reduceAll(
      Array.from({ length: 30 }, (_, i) => e("change.created", { path: `src/w${i}.ts`, operation: "MODIFY" }, `c${i}`))
    );
    expect(state.workingSet.modifiedFiles).toHaveLength(30);
  });

  it("opens the real file when a path is clicked", () => {
    const onOpenFile = vi.fn();
    render(
      <ContextPanel
        workingSet={{ inspectedFiles: ["src/deep/nested/read.ts"], modifiedFiles: ["src/written.ts"] }}
        onOpenFile={onOpenFile}
      />
    );
    fireEvent.click(screen.getByTitle("src/deep/nested/read.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("src/deep/nested/read.ts");
  });

  it("shortens a long path but keeps the whole one reachable", () => {
    render(<ContextPanel workingSet={{ inspectedFiles: ["a/b/c/d/e.ts"], modifiedFiles: [] }} onOpenFile={() => {}} />);
    const chip = screen.getByTitle("a/b/c/d/e.ts");
    expect(chip.textContent).toBe("…/d/e.ts");
  });
});

describe("Changes panel", () => {
  it("offers to open every changed file at once, and names the file when there is only one", () => {
    const onOpenAll = vi.fn();
    const { rerender } = render(
      <ChangesPanel
        changes={[{ path: "src/a.ts", operation: "MODIFY" }]}
        onOpenFile={() => {}}
        onRequestDiff={() => {}}
        onOpenAll={onOpenAll}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Open a\.ts/ }));
    expect(onOpenAll).toHaveBeenCalled();

    rerender(
      <ChangesPanel
        changes={[
          { path: "src/a.ts", operation: "MODIFY" },
          { path: "src/b.ts", operation: "CREATE" }
        ]}
        onOpenFile={() => {}}
        onRequestDiff={() => {}}
        onOpenAll={onOpenAll}
      />
    );
    expect(screen.getByRole("button", { name: /Open all 2 files/ })).toBeTruthy();
  });
});

describe("Onboarding", () => {
  it("fills the composer rather than submitting, so a first click never starts a task", () => {
    const onSuggest = vi.fn();
    render(<Onboarding providers={[ollama]} onSuggest={onSuggest} onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix the failing tests" }));
    expect(onSuggest).toHaveBeenCalledWith("Fix the failing tests in this repository.");
  });

  it("stays out of the way once a provider is usable", () => {
    render(<Onboarding providers={[cloud, ollama]} onSuggest={() => {}} onOpenSettings={() => {}} />);
    expect(screen.queryByText("Connect a model first")).toBeNull();
  });

  it("asks for a provider when none is usable, and names the local one as a way in", () => {
    // A local daemon that is not running is not a usable provider, however little it needs a key.
    render(
      <Onboarding
        providers={[cloud, { ...ollama, status: "CONNECTION_ERROR" }]}
        onSuggest={() => {}}
        onOpenSettings={() => {}}
      />
    );
    expect(screen.getByText("Connect a model first")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use Ollama \(Local\)/ })).toBeTruthy();
  });

  it("says nothing about setup before the catalogue has arrived", () => {
    // An empty provider list means "not loaded yet", not "you have nothing configured".
    render(<Onboarding providers={[]} onSuggest={() => {}} onOpenSettings={() => {}} />);
    expect(screen.queryByText("Connect a model first")).toBeNull();
  });
});

describe("Settings", () => {
  it("points out the provider the host deep-linked to", () => {
    const { container } = render(
      <SettingsView
        providers={[cloud, ollama]}
        testResults={{}}
        testing={undefined}
        target="experiential"
        onClose={() => {}}
        onSave={() => {}}
        onRemove={() => {}}
        onTest={() => {}}
      />
    );
    const card = container.querySelector("#provider-card-experiential");
    expect(card).toBeTruthy();
    expect(card?.className).toMatch(/highlighted/);
    expect(container.querySelector("#provider-card-ollama")?.className).not.toMatch(/highlighted/);
  });

  it("can reveal only the key being typed, never a stored one", () => {
    const { container } = render(
      <SettingsView
        providers={[cloud]}
        testResults={{}}
        testing={undefined}
        onClose={() => {}}
        onSave={() => {}}
        onRemove={() => {}}
        onTest={() => {}}
      />
    );
    const section = container.querySelector("section")!;
    const input = within(section).getByLabelText("API key") as HTMLInputElement;
    const reveal = within(section).getByRole("button", { name: /Show the key you typed/ });

    // Nothing typed: there is nothing to reveal, and a stored key never reaches the panel.
    expect(reveal.hasAttribute("disabled")).toBe(true);
    expect(input.type).toBe("password");

    fireEvent.change(input, { target: { value: "sk-typed" } });
    fireEvent.click(within(section).getByRole("button", { name: /Show the key you typed/ }));
    expect((within(section).getByLabelText("API key") as HTMLInputElement).type).toBe("text");
  });
});

describe("Assistant messages with code", () => {
  it("separates prose from fenced code and keeps the code exact", () => {
    const segments = parseMessage(['Here you go:', '```ts', 'const a = 1;', '```', 'Done.'].join("\n"));
    expect(segments.map(s => s.kind)).toEqual(["text", "code", "text"]);
    expect(segments[1]).toMatchObject({ content: "const a = 1;", language: "ts" });
  });

  it("treats an unterminated fence as code, because a reply is often still arriving", () => {
    const segments = parseMessage("Working:\n```python\nprint(1)");
    expect(segments[1]).toMatchObject({ kind: "code", language: "python", content: "print(1)" });
  });

  it("leaves a message with no fences as a single block of prose", () => {
    expect(parseMessage("Just words.")).toEqual([{ kind: "text", content: "Just words." }]);
  });

  it("suggests a filename from the language, and a plain one when it does not know", () => {
    expect(suggestedFilename("typescript", 0)).toBe("comu-snippet-1.ts");
    expect(suggestedFilename("klingon", 2)).toBe("comu-snippet-3.txt");
    expect(suggestedFilename(undefined, 0)).toBe("comu-snippet-1.txt");
  });

  it("offers Copy and Save on a code block and hands the host the exact content", () => {
    const onSaveCode = vi.fn();
    render(<MessageText text={"Try:\n```js\nconst x = 2;\n```"} onSaveCode={onSaveCode} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    expect(onSaveCode).toHaveBeenCalledWith("const x = 2;", "comu-snippet-1.js");
  });

  it("offers no Save when the host cannot accept one", () => {
    render(<MessageText text={"```\nplain\n```"} />);
    expect(screen.queryByRole("button", { name: "Save as…" })).toBeNull();
  });
});
