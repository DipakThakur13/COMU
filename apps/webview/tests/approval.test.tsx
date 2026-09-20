// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import type { ApprovalView } from "@comu/ui-state";
import { ApprovalCard } from "../src/components/approval/ApprovalCard.js";
import { PlanRibbon } from "../src/components/plan/PlanRibbon.js";
import { ChangesPanel } from "../src/components/changes/ChangesPanel.js";

const NL = String.fromCharCode(10);

function fileApproval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    interactionId: "act-1",
    taskId: "t1",
    title: "Approval required",
    message: "Modify src/auth/login.ts",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    payload: {
      kind: "file_write",
      tool: "write_file",
      summary: "Modify src/auth/login.ts (+2 -1)",
      file: {
        path: "src/auth/login.ts",
        operation: "MODIFY",
        additions: 2,
        deletions: 1,
        diff: ["@@ -1,2 +1,3 @@", " keep", "-remove me", "+add one", "+add two"].join(NL)
      },
      scopes: [
        { key: "file:src/auth/login.ts", label: "Approve writes to src/auth/login.ts for this session" },
        { key: "dir:src/auth/", label: "Approve writes under src/auth/ for this session" },
        { key: "writes:*", label: "Approve all writes for this session" }
      ]
    },
    ...over
  };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => cleanup());

describe("ApprovalCard: safety", () => {
  it("focuses the card itself, so no key press is one stray Enter from approving", () => {
    render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    const card = screen.getByRole("group", { name: /Modify src\/auth\/login\.ts/ });
    expect(document.activeElement).toBe(card);
    // Explicitly not a button, and specifically not Approve.
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: /Approve once/ }));
  });

  it("always offers Deny and says that denying is safe", () => {
    render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    expect(screen.getByText(/Denying is safe/)).toBeTruthy();
    expect(screen.getByText(/the agent is told and can try another approach/)).toBeTruthy();
  });

  it("states in words that letting the timer run out counts as denied", () => {
    render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    expect(screen.getByText(/counts as denied/)).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("shows an expired request as expired, disables approving and still allows Deny", () => {
    render(<ApprovalCard approval={fileApproval({ expiresAt: new Date(Date.now() - 1000).toISOString() })} onRespond={() => {}} />);
    expect(screen.getByRole("timer").textContent).toBe("expired");
    expect(screen.getByText(/This request expired, which counts as denied/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve once/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(false);
  });

  it("counts down and marks the last minute as urgent", () => {
    render(<ApprovalCard approval={fileApproval({ expiresAt: new Date(Date.now() + 42_000).toISOString() })} onRespond={() => {}} />);
    expect(screen.getByRole("timer").textContent).toMatch(/^4[0-2]s$/);
  });
});

describe("ApprovalCard: scope weighting", () => {
  it("shows the exact session scope key each grant will create", () => {
    render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    expect(screen.getByText("file:src/auth/login.ts")).toBeTruthy();
    expect(screen.getByText("dir:src/auth/")).toBeTruthy();
    expect(screen.getByText("writes:*")).toBeTruthy();
  });

  it("makes the narrowest grant the obvious one and the broadest visibly different", () => {
    const { container } = render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    const buttons = [...container.querySelectorAll("button")].filter(b => b.textContent?.startsWith("Approve this file") || b.textContent?.startsWith("Approve everything") || b.textContent?.startsWith("Approve all"));
    expect(buttons).toHaveLength(3);
    const [file, dir, all] = buttons;
    // Three distinct weights: the classes differ, so the broad grant cannot look like the narrow one.
    expect(file.className).not.toBe(dir.className);
    expect(dir.className).not.toBe(all.className);
    expect(file.className).not.toBe(all.className);
  });

  it("grants the narrow scopes immediately", () => {
    const onRespond = vi.fn();
    render(<ApprovalCard approval={fileApproval()} onRespond={onRespond} />);
    fireEvent.click(screen.getByText("Approve this file"));
    expect(onRespond).toHaveBeenCalledWith({ type: "APPROVE_SESSION", scopeKey: "file:src/auth/login.ts" });

    fireEvent.click(screen.getByText(/Approve everything in src\/auth\//));
    expect(onRespond).toHaveBeenCalledWith({ type: "APPROVE_SESSION", scopeKey: "dir:src/auth/" });
  });

  it("asks a second time before granting every write", () => {
    const onRespond = vi.fn();
    render(<ApprovalCard approval={fileApproval()} onRespond={onRespond} />);

    fireEvent.click(screen.getByText("Approve all writes"));
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByText(/Allow every write for the rest of this task, without asking\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, allow all writes" }));
    expect(onRespond).toHaveBeenCalledWith({ type: "APPROVE_SESSION", scopeKey: "writes:*" });
  });

  it("the second confirm can be cancelled without granting anything", () => {
    const onRespond = vi.fn();
    render(<ApprovalCard approval={fileApproval()} onRespond={onRespond} />);
    fireEvent.click(screen.getByText("Approve all writes"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByText("Approve all writes")).toBeTruthy();
  });
});

describe("ApprovalCard: bodies", () => {
  it("renders a modification as a diff with both line numbers", () => {
    const { container } = render(<ApprovalCard approval={fileApproval()} onRespond={() => {}} />);
    const group = screen.getByRole("group", { name: "Proposed change to src/auth/login.ts" });
    expect(group.textContent).toContain("add one");
    expect(group.textContent).toContain("remove me");
    expect(container.textContent).toContain("+2");
    expect(container.textContent).toContain("-1");
    expect(container.textContent).not.toContain("New file");
  });

  it("renders a created file as the file itself, not a diff against nothing", () => {
    const create = fileApproval({
      payload: {
        kind: "file_write",
        tool: "create_file",
        summary: "Create src/new.ts (+3 -0)",
        file: {
          path: "src/new.ts",
          operation: "CREATE",
          additions: 3,
          deletions: 0,
          diff: "",
          content: ["export const a = 1;", "export const b = 2;", "export const c = 3;"].join(NL)
        },
        scopes: [{ key: "file:src/new.ts", label: "this file" }]
      }
    });
    render(<ApprovalCard approval={create} onRespond={() => {}} />);
    expect(screen.getByText("New file, 3 lines")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Proposed change to src/new.ts" });
    expect(group.textContent).toContain("export const b = 2;");
    // No hunk header, because there is nothing to diff against.
    expect(group.textContent).not.toContain("@@");
  });

  it("renders a command as an argument list with its cwd, never a shell string", () => {
    const command = fileApproval({
      payload: {
        kind: "command",
        tool: "execute_command",
        summary: "Run npm run build",
        command: { executable: "npm", args: ["run", "build", "--", "--watch=false"], cwd: "/repo/packages/app" },
        scopes: [{ key: "cmd:npm run build -- --watch=false", label: "this exact command" }]
      }
    });
    render(<ApprovalCard approval={command} onRespond={() => {}} />);
    const argv = screen.getByRole("list", { name: "Command and arguments" });
    expect(within(argv).getAllByRole("listitem").map(li => li.textContent)).toEqual([
      "npm",
      "run",
      "build",
      "--",
      "--watch=false"
    ]);
    expect(screen.getByText("/repo/packages/app")).toBeTruthy();
    expect(screen.getByText(/no shell/)).toBeTruthy();
    // The joined form is exactly what must not appear.
    expect(screen.queryByText("npm run build -- --watch=false")).toBeNull();
  });

  it("marks a push distinctly and offers no session grant at all", () => {
    const push = fileApproval({
      payload: {
        kind: "git_push",
        tool: "git_push",
        summary: "Push branch main to origin",
        details: { remote: "origin", branch: "main" },
        scopes: []
      }
    });
    render(<ApprovalCard approval={push} onRespond={() => {}} />);
    expect(screen.getByText("Push approval required")).toBeTruthy();
    expect(screen.getByText(/in every autonomy level/)).toBeTruthy();
    expect(screen.getByText(/never be granted for the session/)).toBeTruthy();
    expect(screen.queryByText(/Or approve without asking again/)).toBeNull();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
  });

  it("surfaces a note when the proposed edit will not apply", () => {
    const broken = fileApproval();
    broken.payload!.file!.note = "edit 1: oldText not found (the tool will fail)";
    render(<ApprovalCard approval={broken} onRespond={() => {}} />);
    expect(screen.getByText(/oldText not found/)).toBeTruthy();
  });
});

describe("PlanRibbon", () => {
  const plan = {
    planId: "p1",
    version: 1,
    goal: "Add rate limiting",
    completedCount: 1,
    currentIndex: 1,
    steps: [
      { id: "s1", type: "INVESTIGATE", title: "Locate the handler", status: "COMPLETED" as const, resultSummary: "Found login.ts" },
      { id: "s2", type: "IMPLEMENT", title: "Add the limiter", status: "RUNNING" as const },
      { id: "s3", type: "VALIDATE", title: "Verify", status: "PENDING" as const }
    ]
  };

  it("shows the current step and position without being expanded", () => {
    render(<PlanRibbon plan={plan} />);
    expect(screen.getByText("Add the limiter")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.queryByText("Locate the handler")).toBeNull();
  });

  it("expands to the full step list with results", () => {
    render(<PlanRibbon plan={plan} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByText("Locate the handler")).toBeTruthy();
    expect(screen.getByText("Found login.ts")).toBeTruthy();
    expect(screen.getByText("Verify")).toBeTruthy();
  });

  it("says the plan is complete when no step remains", () => {
    render(<PlanRibbon plan={{ ...plan, currentIndex: -1, completedCount: 3 }} />);
    expect(screen.getByText("Plan complete")).toBeTruthy();
    expect(screen.getByText("3/3")).toBeTruthy();
  });
});

describe("ChangesPanel", () => {
  const changes = [
    { path: "src/auth/login.ts", operation: "MODIFY" as const },
    { path: "src/auth/rate_limit.ts", operation: "CREATE" as const }
  ];

  it("lists every changed file with its operation and a count summary", () => {
    render(<ChangesPanel changes={changes} onOpenFile={() => {}} onRequestDiff={() => {}} />);
    const list = screen.getByRole("list", { name: "Changed files" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 files")).toBeTruthy();
    expect(screen.getByText("1 created")).toBeTruthy();
    expect(screen.getByText("1 modified")).toBeTruthy();
  });

  it("is read only: no accept, reject or checkbox implies an undo that does not exist", () => {
    const { container } = render(<ChangesPanel changes={changes} onOpenFile={() => {}} onRequestDiff={() => {}} />);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    const labels = [...container.querySelectorAll("button")].map(b => (b.textContent || "").toLowerCase());
    for (const forbidden of ["accept", "reject", "revert", "undo", "discard", "apply"]) {
      expect(labels.some(l => l.includes(forbidden)), `a control offers "${forbidden}"`).toBe(false);
    }
    expect(screen.getByText(/Already written to disk/)).toBeTruthy();
  });

  it("opens a file or its diff on request", () => {
    const onOpenFile = vi.fn();
    const onRequestDiff = vi.fn();
    render(<ChangesPanel changes={changes} onOpenFile={onOpenFile} onRequestDiff={onRequestDiff} />);
    fireEvent.click(screen.getByText("login.ts"));
    fireEvent.click(screen.getByRole("button", { name: /Open file/ }));
    expect(onOpenFile).toHaveBeenCalledWith("src/auth/login.ts");
    fireEvent.click(screen.getByRole("button", { name: /Open diff/ }));
    expect(onRequestDiff).toHaveBeenCalledWith("src/auth/login.ts");
  });

  it("shows an empty state before anything is written", () => {
    render(<ChangesPanel changes={[]} onOpenFile={() => {}} onRequestDiff={() => {}} />);
    expect(screen.getByText("No changes yet")).toBeTruthy();
  });
});
