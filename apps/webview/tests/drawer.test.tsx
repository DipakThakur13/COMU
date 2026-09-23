// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { VerificationResult, WorkspaceMemoryEntry } from "@comu/protocol";
import { createInitialSessionState, type SessionState, type WorkerView } from "@comu/ui-state";
import { Drawer, availableTabs } from "../src/components/drawer/Drawer.js";

afterEach(() => cleanup());

function session(over: Partial<SessionState> = {}): SessionState {
  return { ...createInitialSessionState(), ...over };
}

const verification: VerificationResult = {
  verificationId: "v1",
  taskId: "t1",
  status: "FAILED",
  summary: "One required check failed.",
  durationMs: 4200,
  timestamp: "2026-09-20T10:00:00.000Z",
  checks: [
    { id: "c1", name: "Typecheck", required: true, status: "PASSED" },
    { id: "c2", name: "Unit tests", required: true, status: "FAILED", details: "3 tests failed", exitCode: 1, command: "pnpm test" },
    { id: "c3", name: "Lint", required: false, status: "SKIPPED", skipReason: "No linter configured" }
  ]
};

const memory: WorkspaceMemoryEntry[] = [
  {
    id: "m1", workspaceId: "w", type: "CONVENTION", content: "Tests live beside the source file.",
    source: "USER", trustLevel: "USER_VERIFIED", confidence: 1, createdAt: "", updatedAt: "",
    status: "ACTIVE", scope: { workspaceId: "w" }, contentHash: "h1"
  },
  {
    id: "m2", workspaceId: "w", type: "LESSON", content: "The build needs Node 20.",
    source: "AGENT", trustLevel: "AGENT_DERIVED", confidence: 0.4, createdAt: "", updatedAt: "",
    status: "STALE", scope: { workspaceId: "w", files: ["package.json"] }, contentHash: "h2"
  }
];

const workers: WorkerView[] = [
  { subagentId: "s1", subagentType: "research", goal: "Find the auth entry point", status: "RUNNING", streamText: "reading src/auth…" },
  { subagentId: "s2", subagentType: "review", status: "FAILED", summary: "Could not reach the linter." }
];

function draw(state: SessionState, open?: Parameters<typeof Drawer>[0]["open"], onSelect = vi.fn()) {
  return { onSelect, ...render(<Drawer session={state} open={open} onSelect={onSelect} />) };
}

describe("Which surfaces exist", () => {
  it("renders nothing at all when no surface has content", () => {
    const { container } = draw(session());
    expect(container.firstChild).toBeNull();
  });

  it("offers a surface only once it has content", () => {
    expect(availableTabs(session()).map(t => t.id)).toEqual([]);
    expect(availableTabs(session({ verification })).map(t => t.id)).toEqual(["verification"]);
    expect(availableTabs(session({ memory })).map(t => t.id)).toEqual(["memory"]);
    expect(availableTabs(session({ workers })).map(t => t.id)).toEqual(["workers"]);
  });

  it("does not offer Overview for a task that has only just started", () => {
    // Status already lives in the header; a drawer that repeats it is a tab leading nowhere.
    expect(availableTabs(session({ taskId: "t1", status: "running" })).map(t => t.id)).toEqual([]);
  });

  it("offers Overview once the task has something to summarise", () => {
    // A task that simply finished has nothing here the stream and the header did not already say.
    expect(availableTabs(session({ taskId: "t1", status: "completed" })).map(t => t.id)).toEqual([]);
    expect(availableTabs(session({ approvals: [{ decision: "DENIED" } as never] })).map(t => t.id)).toContain("overview");
    expect(availableTabs(session({ error: { code: "E", message: "m" } })).map(t => t.id)).toContain("overview");
  });

  it("badges the counts that are worth seeing without opening the drawer", () => {
    const tabs = availableTabs(session({ verification, memory, workers }));
    expect(tabs.find(t => t.id === "verification")?.count).toBe(1); // one failed check
    expect(tabs.find(t => t.id === "memory")?.count).toBe(2);
    expect(tabs.find(t => t.id === "workers")?.count).toBe(2);
  });

  it("keeps a stable order so a tab does not move under the pointer as content arrives", () => {
    const all = availableTabs(session({ taskId: "t", status: "failed", error: { code: "E", message: "m" }, verification, memory, workers }));
    expect(all.map(t => t.id)).toEqual(["overview", "verification", "workers", "memory"]);
  });
});

describe("Opening and closing", () => {
  it("starts closed, showing labelled tabs and no body", () => {
    draw(session({ memory }));
    expect(screen.getByRole("tab", { name: /Memory/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Memory" })).toBeNull();
  });

  it("labels every tab in words, never an icon alone", () => {
    draw(session({ taskId: "t", status: "failed", error: { code: "E", message: "m" }, verification, memory, workers }));
    for (const name of ["Overview", "Verification", "Workers", "Memory"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) }).textContent).toContain(name);
    }
  });

  it("reports which tab is open to assistive technology", () => {
    draw(session({ memory }), "memory");
    const tab = screen.getByRole("tab", { name: /Memory/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Memory" })).toBeTruthy();
  });

  it("asks the store to toggle when a tab is clicked", () => {
    const { onSelect } = draw(session({ memory }));
    fireEvent.click(screen.getByRole("tab", { name: /Memory/ }));
    expect(onSelect).toHaveBeenCalledWith("memory");
  });

  it("falls back to closed when the open surface loses its content", () => {
    // Workers finish and disappear while their panel is open: show the strip, not an empty body
    // claiming a tab that is no longer there.
    draw(session({ memory }), "workers");
    expect(screen.queryByRole("region", { name: "Workers" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Memory" })).toBeNull();
    expect(screen.getByRole("tab", { name: /Memory/ }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("Verification", () => {
  it("puts failed checks first, because that is why the panel was opened", () => {
    draw(session({ verification }), "verification");
    const names = [...screen.getByRole("list", { name: "Verification checks" }).querySelectorAll("li")]
      .map(li => li.textContent ?? "");
    expect(names[0]).toContain("Unit tests");
  });

  it("says why a check did not run rather than leaving it blank", () => {
    draw(session({ verification }), "verification");
    expect(screen.getByText("No linter configured")).toBeTruthy();
  });

  it("distinguishes an optional check from a required one", () => {
    draw(session({ verification }), "verification");
    const lint = screen.getByText("Lint").closest("li")!;
    expect(within(lint).getByText("optional")).toBeTruthy();
  });

  it("states the overall result in words and counts what passed", () => {
    draw(session({ verification }), "verification");
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("1 of 3 checks passed")).toBeTruthy();
  });
});

describe("Memory", () => {
  it("says how far each memory can be trusted, in words", () => {
    draw(session({ memory }), "memory");
    expect(screen.getByText("You confirmed this")).toBeTruthy();
    expect(screen.getByText("Inferred by COMU")).toBeTruthy();
  });

  it("orders the most trustworthy first", () => {
    draw(session({ memory }), "memory");
    const items = [...screen.getByRole("list", { name: "Workspace memory" }).querySelectorAll("li")];
    expect(items[0].textContent).toContain("Tests live beside the source file.");
  });

  it("shows a stale memory rather than hiding it, and marks it", () => {
    draw(session({ memory }), "memory");
    expect(screen.getByText("The build needs Node 20.")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
  });

  it("offers no edit or delete control, because the engine has no such operation", () => {
    draw(session({ memory }), "memory");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Workers", () => {
  it("names each worker and states its status in words", () => {
    draw(session({ workers }), "workers");
    expect(screen.getByText("research")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("keeps a worker's live text inside its own row", () => {
    draw(session({ workers }), "workers");
    const row = screen.getByText("research").closest("li")!;
    expect(within(row).getByText("reading src/auth…")).toBeTruthy();
  });

  it("shows live text only while the worker is running", () => {
    draw(session({ workers: [{ ...workers[0], status: "COMPLETED", streamText: "leftover" }] }), "workers");
    expect(screen.queryByText("leftover")).toBeNull();
  });
});

describe("Overview", () => {
  it("records every approval decision, including the automatic ones", () => {
    const approvals = [
      { type: "approval.decided", eventId: "e1", taskId: "t", timestamp: "", tool: "write_file", kind: "file_write", summary: "Modify a.ts", approved: true, decision: "APPROVED_SESSION", scopeKey: "dir:src/" },
      { type: "approval.decided", eventId: "e2", taskId: "t", timestamp: "", tool: "git_push", kind: "git_push", summary: "Push to origin", approved: false, decision: "TIMEOUT" }
    ] as SessionState["approvals"];
    draw(session({ approvals }), "overview");

    expect(screen.getByText(/Approved for the session/)).toBeTruthy();
    expect(screen.getByText(/dir:src\//)).toBeTruthy();
    // An expiry is a denial, and it says so rather than reading as "no answer".
    expect(screen.getByText("Expired with no answer, so denied")).toBeTruthy();
    expect(screen.getByText("Refused")).toBeTruthy();
  });

  it("explains a headless denial in terms a person can act on", () => {
    const approvals = [
      { type: "approval.decided", eventId: "e1", taskId: "t", timestamp: "", tool: "write_file", kind: "file_write", summary: "Modify a.ts", approved: false, decision: "NO_HUMAN_OBSERVER" }
    ] as SessionState["approvals"];
    draw(session({ approvals }), "overview");
    expect(screen.getByText("Nobody was watching, so denied")).toBeTruthy();
  });

  it("shows the failure and its hint when the task failed", () => {
    draw(session({ error: { code: "E_TOOL", message: "read_file failed", hint: "Check the path." } }), "overview");
    expect(screen.getByText("read_file failed")).toBeTruthy();
    expect(screen.getByText("Check the path.")).toBeTruthy();
    expect(screen.getByText("E_TOOL")).toBeTruthy();
  });

  it("says so rather than rendering an empty panel when there is nothing to summarise", () => {
    // A task stopped before it produced anything still earns the tab, and the panel says so.
    draw(session({ taskId: "t", status: "cancelled" }), "overview");
    expect(screen.getByText("Nothing to summarise yet")).toBeTruthy();
  });
});
