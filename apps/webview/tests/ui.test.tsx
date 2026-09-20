// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import { createInitialSessionState, reduceEvent, SessionState } from "@comu/ui-state";
import type { AgentEvent } from "@comu/protocol";
import { Header } from "../src/components/Header.js";
import { Composer } from "../src/components/Composer.js";
import { ActivityStream } from "../src/components/activity/ActivityStream.js";
import { Button, ErrorBoundary, StatusPill } from "../src/components/primitives/index.js";

/**
 * jsdom has no ResizeObserver and reports every element as zero-sized. @tanstack/virtual-core
 * measures with offsetWidth/offsetHeight and observes through window.ResizeObserver, so supply
 * both and the virtualiser windows exactly as it does in the panel.
 */
class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const height = (target as HTMLElement).offsetHeight;
    const entry = {
      target,
      borderBoxSize: [{ inlineSize: 340, blockSize: height }]
    } as unknown as ResizeObserverEntry;
    // Asynchronous, like the real thing, so React commits before the measurement lands.
    setTimeout(() => this.callback([entry], this as unknown as ResizeObserver), 0);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ImmediateResizeObserver;

const VIEWPORT = 600;
const ROW = 34;

function giveElementsSize() {
  for (const prop of ["offsetHeight", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("data-index") !== null ? ROW : VIEWPORT;
      }
    });
  }
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 340 });
}

/** Lets effects run and the resize measurement land, as it would in a real frame. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

let counter = 0;
function ev(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  counter += 1;
  return { type, eventId: `e${counter}`, taskId: "t1", timestamp: "2026-09-20T10:00:00.000Z", ...extra } as AgentEvent;
}

function stateFrom(events: AgentEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialSessionState());
}

beforeEach(() => giveElementsSize());
afterEach(() => cleanup());

describe("Primitives", () => {
  it("an icon-only button is never unlabelled", () => {
    render(<Button icon="stop" label="Stop the task" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Stop the task" })).toBeTruthy();
  });

  it("a button with text uses its text as the accessible name", () => {
    render(<Button onClick={() => {}}>Approve</Button>);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("status pills render their label as text, not as an emoji", () => {
    const { container } = render(<StatusPill tone="waiting">Waiting for you</StatusPill>);
    expect(container.textContent).toContain("Waiting for you");
    // No emoji anywhere: icons are SVG so they can inherit theme colour.
    expect(/\p{Extended_Pictographic}/u.test(container.textContent || "")).toBe(false);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("an error boundary contains a failure and names the region", () => {
    const Boom = () => {
      throw new Error("component exploded");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <ErrorBoundary region="activity stream">
          <Boom />
        </ErrorBoundary>
        <p>still here</p>
      </div>
    );
    expect(screen.getByRole("alert").textContent).toContain("activity stream");
    expect(screen.getByText("still here")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("Header", () => {
  const base = stateFrom([ev("task.started"), ev("agent.status", { status: "THINKING" })]);

  it("shows the human-readable state and the step position", () => {
    const withPlan = reduceEvent(
      base,
      ev("plan.created", {
        planVersion: 1,
        plan: {
          planId: "p",
          goal: "g",
          steps: [
            { id: "s1", type: "INVESTIGATE", title: "a", status: "COMPLETED" },
            { id: "s2", type: "IMPLEMENT", title: "b", status: "RUNNING" },
            { id: "s3", type: "VALIDATE", title: "c", status: "PENDING" }
          ]
        }
      })
    );
    render(<Header session={withPlan} onCancel={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
  });

  it("surfaces token usage and a cost when the model has a price", () => {
    const used = reduceEvent(
      { ...base, taskId: "t1" },
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 18450, completionTokens: 890, totalTokens: 19340 }, costUsd: 0.0421 })
    );
    render(<Header session={used} onCancel={() => {}} onOpenSettings={() => {}} />);
    const header = screen.getByLabelText("Task metrics");
    expect(header.textContent).toContain("19.3k tokens");
    expect(header.textContent).toContain("$0.0421");
  });

  it("says the cost is unknown rather than showing zero", () => {
    const used = reduceEvent(
      { ...base, taskId: "t1" },
      ev("model_request.succeeded", { requestId: "r1", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } })
    );
    render(<Header session={used} onCancel={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByText("cost unknown")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("offers Stop only while the task is running", () => {
    const { rerender } = render(<Header session={base} onCancel={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /Stop the task/ })).toBeTruthy();

    const done = reduceEvent(base, ev("task.completed", { finalText: "done" }));
    rerender(<Header session={done} onCancel={() => {}} onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: /Stop the task/ })).toBeNull();
    expect(screen.getByText("Completed")).toBeTruthy();
  });
});

describe("Composer", () => {
  const providers = [
    {
      providerId: "nvidia",
      displayName: "NVIDIA",
      enabled: true,
      hasCredential: true,
      isLocal: false,
      status: "CONNECTED" as const,
      models: [{ id: "m1", name: "Nemotron" }]
    }
  ];

  function renderComposer(over: Partial<React.ComponentProps<typeof Composer>> = {}) {
    return render(
      <Composer
        text=""
        mode="AUTO"
        autonomy="ask"
        modelId="m1"
        providers={providers}
        busy={false}
        onText={() => {}}
        onMode={() => {}}
        onAutonomy={() => {}}
        onModel={() => {}}
        onSubmit={() => {}}
        {...over}
      />
    );
  }

  it("has one input and three labelled controls in a single row", () => {
    renderComposer();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Autonomy" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
  });

  it("marks the autonomy level so it is always readable", () => {
    const { container, rerender } = renderComposer({ autonomy: "auto" });
    expect(container.querySelector('[data-level="auto"]')).toBeTruthy();
    rerender(
      <Composer
        text=""
        mode="AUTO"
        autonomy="readonly"
        modelId="m1"
        providers={providers}
        busy={false}
        onText={() => {}}
        onMode={() => {}}
        onAutonomy={() => {}}
        onModel={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(container.querySelector('[data-level="readonly"]')).toBeTruthy();
  });

  it("cannot send an empty prompt or one with no model", () => {
    const { rerender } = renderComposer();
    expect(screen.getByRole("button", { name: /Send/ }).hasAttribute("disabled")).toBe(true);

    rerender(
      <Composer
        text="do something"
        mode="AUTO"
        autonomy="ask"
        modelId={undefined}
        providers={providers}
        busy={false}
        onText={() => {}}
        onMode={() => {}}
        onAutonomy={() => {}}
        onModel={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /Send/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("ActivityStream", () => {
  it("shows an empty state rather than a blank panel", () => {
    render(<ActivityStream entries={[]} elidedCount={0} expandedIds={[]} onToggle={() => {}} status="idle" />);
    expect(screen.getByText("Nothing running")).toBeTruthy();
  });

  it("renders a grouped run of reads as one row with a count", async () => {
    const state = stateFrom([
      ev("tool.completed", { tool: "read_file", path: "a.ts" }),
      ev("tool.completed", { tool: "read_file", path: "b.ts" }),
      ev("tool.completed", { tool: "read_file", path: "c.ts" })
    ]);
    render(
      <ActivityStream entries={state.activity} elidedCount={0} expandedIds={[]} onToggle={() => {}} status="running" />
    );
    await settle();
    const log = screen.getByRole("log", { name: "Activity" });
    expect(log.textContent).toContain("Read 3 files");
    expect(within(log).getByTitle("3 items").textContent).toBe("3");
  });

  it("virtualises: a thousand entries do not become a thousand rows", async () => {
    const events = Array.from({ length: 1000 }, (_, i) => ev("agent.status", { status: `THINKING ${i}` }));
    const state = stateFrom(events);
    const { container } = render(
      <ActivityStream entries={state.activity} elidedCount={0} expandedIds={[]} onToggle={() => {}} status="running" />
    );
    await settle();
    const rendered = container.querySelectorAll("[data-index]").length;
    expect(state.activity.length).toBe(1000);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(120);
  });

  it("says so when earlier activity was elided instead of losing it silently", () => {
    const state = stateFrom([ev("task.started")]);
    const { container } = render(
      <ActivityStream entries={state.activity} elidedCount={1200} expandedIds={[]} onToggle={() => {}} status="running" />
    );
    expect(container.textContent).toContain("1,200 earlier activities elided");
  });

  it("renders streaming text live with a polite live region", () => {
    render(
      <ActivityStream
        entries={[]}
        elidedCount={0}
        streamingText="I will add a rate limiter"
        expandedIds={[]}
        onToggle={() => {}}
        status="running"
      />
    );
    const live = screen.getByText(/I will add a rate limiter/);
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("marks the log busy while the task runs", () => {
    const state = stateFrom([ev("task.started")]);
    render(
      <ActivityStream entries={state.activity} elidedCount={0} expandedIds={[]} onToggle={() => {}} status="running" />
    );
    expect(screen.getByRole("log", { name: "Activity" }).getAttribute("aria-busy")).toBe("true");
  });
});
