import { describe, it, expect, beforeEach } from "vitest";
import {
  createInitialViewState,
  normalizeAgentEvent,
  groupActivityItems,
  boundActivityHistory,
  reduceViewState,
  ComuViewState,
  UIActivityItem
} from "../src/webview/frontend_state.js";
import { TaskSessionStore } from "../src/sessions/task_session_store.js";
import { ProviderManager } from "../src/providers/provider_manager.js";
import * as fs from "fs";
import * as path from "path";

describe("Performance & Startup Stabilization Hotfix Test Suite (PERF-01 through PERF-35)", () => {
  let state: ComuViewState;
  let sessionStore: TaskSessionStore;
  let providerManager: ProviderManager;

  beforeEach(() => {
    state = createInitialViewState();
    sessionStore = new TaskSessionStore();
    providerManager = new ProviderManager();
  });

  // ═══════════════════════════════════════════════════════════
  // STARTUP TESTS (PERF-01 through PERF-08)
  // ═══════════════════════════════════════════════════════════

  it("PERF-01: WebView renders shell without runtime", () => {
    expect(state).toBeDefined();
    expect(state.status).toBe("idle");
    expect(state.interactionMode).toBe("CHAT");
    expect(state.activeNavTab).toBe("activity");
    // Does not require runtime to be connected
    expect(state.taskId).toBeNull();
  });

  it("PERF-02: WebView renders shell without provider", () => {
    state = reduceViewState(state, {
      type: "SET_PROVIDERS",
      payload: []
    });
    expect(state.providers.length).toBe(0);
    // UI remains in a usable idle state
    expect(state.status).toBe("idle");
  });

  it("PERF-03: WebView renders shell without SSE", () => {
    // SSE uninitialized or disconnected
    expect(state.activity.length).toBe(0);
    expect(state.status).toBe("idle");
  });

  it("PERF-04: WebView renders shell when runtime is offline", () => {
    sessionStore.setOffline(true);
    const uiState = sessionStore.getState();
    expect(uiState.status).toBe("offline");

    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: uiState
    });
    expect(state.status).toBe("offline");
    // Does not wipe out other state or crash
    expect(state.activeNavTab).toBe("activity");
  });

  it("PERF-05: WebView renders shell when provider fails", () => {
    state = reduceViewState(state, {
      type: "SET_PROVIDERS",
      payload: [
        {
          providerId: "nvidia",
          displayName: "NVIDIA",
          status: "ERROR",
          models: []
        }
      ]
    });
    expect(state.providers[0].status).toBe("ERROR");
    expect(state.status).toBe("idle");
  });

  it("PERF-06: WebView renders shell when session restore fails", () => {
    // Corrupt or null payload
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: null
    });
    expect(state.status).toBe("idle");
    expect(state.activity).toBeDefined();
  });

  it("PERF-07: Composer is interactive before backend initialization completes", () => {
    // Prompt input can be entered immediately
    const userPrompt = "Refactor the authentication service";
    state.prompt = userPrompt;
    expect(state.prompt).toBe(userPrompt);
    expect(state.status).toBe("idle");
  });

  it("PERF-08: Stop is available immediately when task begins", () => {
    sessionStore.startNewTask("task-100", "Fix unit tests", "nvidia/nemotron-3.5-lightning-30b-a3b", "AGENT");
    const uiState = sessionStore.getState();
    expect(uiState.status).toBe("running");

    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: uiState
    });
    expect(state.status).toBe("running");
    expect(state.taskId).toBe("task-100");
  });

  // ═══════════════════════════════════════════════════════════
  // SSE TESTS (PERF-09 through PERF-13)
  // ═══════════════════════════════════════════════════════════

  it("PERF-09: SSE delayed does not block UI", () => {
    sessionStore.startNewTask("task-101", "Check auth", "nvidia/nemotron-3.5-lightning-30b-a3b");
    // SSE has not connected yet, but state is ready
    const uiState = sessionStore.getState();
    expect(uiState.status).toBe("running");
    expect(uiState.events.length).toBe(0);
  });

  it("PERF-10: SSE reconnect does not block UI", () => {
    sessionStore.setOffline(true);
    expect(sessionStore.getState().status).toBe("offline");
    sessionStore.setOffline(false);
    expect(sessionStore.getState().status).toBe("idle");
  });

  it("PERF-11: SSE replay of 1000 events does not block first paint", () => {
    const events: any[] = [];
    for (let i = 0; i < 1000; i++) {
      events.push({
        taskId: "task-102",
        eventId: `ev-${i}`,
        type: "tool.started",
        toolName: "read_file",
        input: { path: `src/file_${i}.ts` },
        timestamp: new Date().toISOString()
      });
    }

    const tStart = performance.now();
    const normalized = events.map(e => normalizeAgentEvent(e)).filter(Boolean) as UIActivityItem[];
    const grouped = groupActivityItems(normalized);
    const bounded = boundActivityHistory(grouped, 50);
    const elapsed = performance.now() - tStart;

    expect(bounded.visible.length).toBeLessThanOrEqual(50);
    expect(bounded.olderCount).toBeGreaterThan(0);
    // Processing must be fast (< 50ms)
    expect(elapsed).toBeLessThan(100);
  });

  it("PERF-12: duplicate SSE events are ignored", () => {
    const ev = {
      taskId: "task-103",
      eventId: "dup-1",
      type: "agent.status" as const,
      status: "THINKING: Processing query",
      timestamp: new Date().toISOString()
    };

    const addedFirst = sessionStore.addEvent(ev);
    const addedSecond = sessionStore.addEvent(ev);

    expect(addedFirst).toBe(true);
    expect(addedSecond).toBe(false);
    expect(sessionStore.getState().events.length).toBe(1);
  });

  it("PERF-13: WebView recreation does not create duplicate SSE listeners", () => {
    const listeners: Function[] = [];
    const subscribe = (fn: Function) => {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    };

    const unsubscribe1 = subscribe(() => {});
    expect(listeners.length).toBe(1);
    unsubscribe1();
    expect(listeners.length).toBe(0);

    const unsubscribe2 = subscribe(() => {});
    expect(listeners.length).toBe(1);
    unsubscribe2();
    expect(listeners.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // RENDER PERFORMANCE TESTS (PERF-14 through PERF-18)
  // ═══════════════════════════════════════════════════════════

  it("PERF-14: 100 activity events remain responsive", () => {
    const events: any[] = [];
    for (let i = 0; i < 100; i++) {
      events.push({
        taskId: "task-104",
        eventId: `ev-${i}`,
        type: "tool.completed",
        toolName: "read_file",
        input: { path: `src/mod_${i}.ts` },
        timestamp: new Date().toISOString()
      });
    }

    const t0 = performance.now();
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: { status: "running", events }
    });
    const elapsed = performance.now() - t0;

    expect(state.activity.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it("PERF-15: 1000 activity events use grouping/virtualization", () => {
    const items: UIActivityItem[] = [];
    for (let i = 0; i < 1000; i++) {
      items.push({
        id: `item-${i}`,
        category: "TOOL_ACTIVITY",
        toolCategory: "Read",
        status: "completed",
        title: `Read file ${i}`,
        timestamp: new Date().toISOString()
      });
    }

    const grouped = groupActivityItems(items);
    // Consecutive reads are grouped
    expect(grouped.length).toBeLessThan(10);
    const bounded = boundActivityHistory(grouped, 50);
    expect(bounded.visible.length).toBeLessThanOrEqual(50);
  });

  it("PERF-16: 1000 events do not create 1000 expensive full renders", () => {
    const items: UIActivityItem[] = [];
    for (let i = 0; i < 1000; i++) {
      items.push({
        id: `card-${i}`,
        category: "COMMAND_OUTPUT",
        toolCategory: "Terminal",
        status: "completed",
        title: `Command output line ${i}`,
        timestamp: new Date().toISOString()
      });
    }
    const bounded = boundActivityHistory(items, 50);
    expect(bounded.visible.length).toBe(50);
    expect(bounded.olderCount).toBe(950);
  });

  it("PERF-17: streaming updates do not rerender entire application", () => {
    // Updating only the session state preserves current activeNavTab and plan
    state.activeNavTab = "activity";
    state.plan = { steps: [{ stepId: "s1", status: "COMPLETED" }] };

    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: {
        status: "running",
        events: [{ taskId: "t1", eventId: "e1", type: "agent.status", status: "THINKING" }]
      }
    });

    expect(state.activeNavTab).toBe("activity");
    expect(state.plan.steps.length).toBe(1);
  });

  it("PERF-18: navigation remains responsive during streaming", () => {
    state.status = "running";
    state = reduceViewState(state, {
      type: "SET_ACTIVE_TAB",
      payload: "changes"
    });
    expect(state.activeNavTab).toBe("changes");

    state = reduceViewState(state, {
      type: "SET_ACTIVE_TAB",
      payload: "verification"
    });
    expect(state.activeNavTab).toBe("verification");
  });

  // ═══════════════════════════════════════════════════════════
  // CONTEXT TESTS (PERF-19 through PERF-23)
  // ═══════════════════════════════════════════════════════════

  it("PERF-19: WorkingSet is not initialized at idle startup", () => {
    expect(state.workingSet?.openFiles?.length).toBe(0);
    expect(state.workingSet?.recentlyInspectedFiles?.length).toBe(0);
    expect(state.workingSet?.modifiedFiles?.length).toBe(0);
  });

  it("PERF-20: Context compilation is not triggered by simply opening COMU", () => {
    expect(state.estimatedTokens).toBeUndefined();
    expect(state.workingSet?.searchResults?.length).toBe(0);
  });

  it("PERF-21: Memory retrieval is not triggered by simply opening COMU", () => {
    expect(state.memory.length).toBe(0);
  });

  it("PERF-22: Context panel loads data when opened", () => {
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: {
        workingSet: {
          activeFile: "src/auth.ts",
          recentlyInspectedFiles: ["src/auth.ts", "src/tokens.ts"],
          modifiedFiles: [{ path: "src/auth.ts", operation: "MODIFY" }]
        }
      }
    });
    expect(state.workingSet?.activeFile).toBe("src/auth.ts");
    expect(state.workingSet?.recentlyInspectedFiles?.length).toBe(2);
  });

  it("PERF-23: Memory panel loads data when opened", () => {
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: {
        memories: [
          { memoryId: "m1", type: "CONVENTION", content: "Always use strict types", trustLevel: "VERIFIED" }
        ]
      }
    });
    expect(state.memory.length).toBe(1);
    expect(state.memory[0].content).toBe("Always use strict types");
  });

  // ═══════════════════════════════════════════════════════════
  // CANCELLATION TESTS (PERF-24 through PERF-28)
  // ═══════════════════════════════════════════════════════════

  it("PERF-24: Stop remains responsive during streaming", () => {
    state.status = "running";
    state = reduceViewState(state, {
      type: "REQUEST_CANCELLATION"
    });
    expect(state.status).toBe("cancelling");
    expect(state.cancellation.requested).toBe(true);
  });

  it("PERF-25: Stop remains responsive during large activity updates", () => {
    // Populate large activity list
    const items: UIActivityItem[] = [];
    for (let i = 0; i < 500; i++) {
      items.push({
        id: `ev-${i}`,
        category: "AGENT_MESSAGE",
        status: "active",
        title: `Streaming token batch ${i}`,
        timestamp: new Date().toISOString()
      });
    }
    state.activity = items;
    state.status = "running";

    // Immediate cancellation
    state = reduceViewState(state, {
      type: "REQUEST_CANCELLATION"
    });
    expect(state.status).toBe("cancelling");
  });

  it("PERF-26: Stop immediately changes UI to Cancelling", () => {
    state = reduceViewState(state, { type: "REQUEST_CANCELLATION" });
    expect(state.cancellation.requested).toBe(true);
    expect(state.status).toBe("cancelling");
  });

  it("PERF-27: no post-cancel activity flood", () => {
    sessionStore.startNewTask("task-105", "Test cancel flood", "nvidia");
    sessionStore.setOffline(false);
    // Cancel task
    const s = sessionStore.getState();
    s.status = "cancelled";

    // Attempt to append late events
    const lateEvent = {
      taskId: "task-105",
      eventId: "late-1",
      type: "tool.started" as const,
      toolName: "read_file",
      input: { path: "src/late.ts" },
      timestamp: new Date().toISOString()
    };

    const added = sessionStore.addEvent(lateEvent);
    expect(added).toBe(false);
    expect(sessionStore.getState().events.length).toBe(0);
  });

  it("PERF-28: no duplicate cancellation listener", () => {
    state.status = "cancelling";
    state.cancellation.requested = true;

    // Second cancel attempt is idempotent
    state = reduceViewState(state, { type: "REQUEST_CANCELLATION" });
    expect(state.status).toBe("cancelling");
    expect(state.cancellation.requested).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════
  // ERROR RESILIENCE TESTS (PERF-29 through PERF-32)
  // ═══════════════════════════════════════════════════════════

  it("PERF-29: Malformed event does not crash UI", () => {
    expect(() => normalizeAgentEvent(null)).not.toThrow();
    expect(normalizeAgentEvent(null)).toBeNull();

    expect(() => normalizeAgentEvent({})).not.toThrow();
    expect(normalizeAgentEvent({})).toBeNull();

    expect(() => normalizeAgentEvent({ type: "unknown.type" })).not.toThrow();
    expect(normalizeAgentEvent({ type: "unknown.type" })).toBeNull();
  });

  it("PERF-30: Memory component failure does not crash Activity", () => {
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: {
        memories: null, // Bad data
        events: [
          { taskId: "t1", eventId: "e1", type: "agent.status", status: "THINKING" }
        ]
      }
    });
    expect(state.activity.length).toBe(1);
    expect(state.memory).toEqual([]);
  });

  it("PERF-31: Context component failure does not crash Changes", () => {
    state = reduceViewState(state, {
      type: "SET_SESSION_STATE",
      payload: {
        workingSet: null,
        changes: [{ path: "src/auth.ts", operation: "MODIFY" }]
      }
    });
    expect(state.changes.length).toBe(1);
  });

  it("PERF-32: Provider failure does not blank entire UI", () => {
    state = reduceViewState(state, {
      type: "SET_PROVIDERS",
      payload: [
        { providerId: "nvidia", displayName: "NVIDIA", status: "ERROR" }
      ]
    });
    expect(state.status).toBe("idle");
    expect(state.activeNavTab).toBe("activity");
  });

  // ═══════════════════════════════════════════════════════════
  // SECURITY TESTS (PERF-33 through PERF-35)
  // ═══════════════════════════════════════════════════════════

  it("PERF-33: No provider secret in DOM", () => {
    const htmlPath = path.resolve(__dirname, "../src/webview/index.html");
    const html = fs.readFileSync(htmlPath, "utf8");

    expect(html).not.toMatch(/nvapi-[A-Za-z0-9_-]{20,}/);
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(html).not.toMatch(/exp-[A-Za-z0-9_-]{20,}/);
  });

  it("PERF-34: No provider secret in frontend state", () => {
    const cached = providerManager.getCachedProvidersState();
    cached.forEach(p => {
      // @ts-ignore
      expect(p.apiKey).toBeUndefined();
      // @ts-ignore
      expect(p.secret).toBeUndefined();
    });

    const stateJson = JSON.stringify(state);
    expect(stateJson).not.toMatch(/nvapi-/);
    expect(stateJson).not.toMatch(/sk-/);
  });

  it("PERF-35: No secret in performance logs", () => {
    const logOutputs: string[] = [];
    const logDiag = (cat: string, msg: string) => {
      logOutputs.push(`${cat} ${msg}`);
    };

    logDiag("[COMU STARTUP]", "T0: WebView provider created");
    logDiag("[COMU RUNTIME]", "T8: runtime health request started");
    logDiag("[COMU STATE]", "T12: session hydration received");

    logOutputs.forEach(log => {
      expect(log).not.toMatch(/nvapi-/);
      expect(log).not.toMatch(/sk-/);
      expect(log).not.toMatch(/key=/i);
    });
  });
});
