import { useEffect, useState } from "react";
import type { AgentEvent, ProviderConfig, WorkspaceMemoryEntry } from "@comu/protocol";
import { EventSequencer, HostToWebviewMessage, SessionState, WebviewToHostMessage, createInitialSessionState, reduceEvent } from "@comu/ui-state";
import { VsCodeApi, connectToHost } from "../store/store.js";
import { FIXTURES, fixtureById } from "./fixtures.js";
import { HARNESS_THEMES, ThemeId, applyHarnessTheme } from "./themes.js";
import styles from "./harness.module.css";

/**
 * Standalone browser harness.
 *
 * Stands in for the extension host so the interface can be built and reviewed at
 * http://127.0.0.1:3000 without reloading an extension host. It plays the authoritative role for
 * real: it reduces fixture events into a SessionState, stamps them with sequence numbers and
 * delivers them exactly as the host does, so replication and gap handling are exercised here too.
 */

/** Probe times relative to the clock, which the visual suite freezes, so renders stay identical. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const PROVIDERS: ProviderConfig[] = [
  {
    // The case that prompted probe-derived badges: a key is saved and the last probe timed out.
    providerId: "nvidia",
    displayName: "NVIDIA",
    description: "NVIDIA NIM high-performance engineering models.",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    enabled: true,
    hasCredential: true,
    isLocal: false,
    status: "TIMEOUT",
    lastCheck: {
      provider: "nvidia",
      status: "TIMEOUT",
      message: "Connection timed out after 15 seconds.",
      checkedAt: minutesAgo(3)
    },
    models: [
      { id: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning", description: "Fast agent", contextTokens: 128000 },
      { id: "deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813", description: "Deep engineering", contextTokens: 128000 },
      { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731", description: "Fast agent + chat", contextTokens: 128000 },
      { id: "moonshotai/kimi-k3", name: "Kimi K3", description: "Frontier coding", contextTokens: 128000 },
      { id: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1", description: "Long-horizon coding", contextTokens: 32768 },
      { id: "meta/muse-glimmer-30b", name: "Muse Glimmer 30B", description: "Multimodal specialist", contextTokens: 128000 },
      { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra", description: "High compute", contextTokens: 128000 }
    ]
  },
  {
    providerId: "experiential",
    displayName: "GPT-6 Astra (Experiential Labs)",
    description: "Frontier reasoning and coding with a 1.05M token context window.",
    endpoint: "https://api.experientiallabs.ai/v1",
    enabled: true,
    hasCredential: false,
    isLocal: false,
    status: "NOT_CONFIGURED",
    models: [{ id: "gpt-6-astra", name: "GPT-6 Astra", description: "1.05M context", contextTokens: 1050000 }]
  },
  {
    providerId: "openai",
    displayName: "OpenAI-Compatible",
    description: "Connect any OpenAI-compatible endpoint with your own key.",
    endpoint: "https://api.openai.com/v1",
    enabled: true,
    // A key saved and never probed: grey, not green.
    hasCredential: true,
    isLocal: false,
    status: "UNCHECKED",
    models: [{ id: "gpt-4o", name: "GPT-4o", contextTokens: 128000 }]
  },
  {
    providerId: "ollama",
    displayName: "Ollama (Local)",
    description: "Local on-device inference. No API key, nothing leaves your machine.",
    endpoint: "http://127.0.0.1:11434",
    enabled: true,
    hasCredential: true,
    isLocal: true,
    status: "CONNECTED",
    lastCheck: { provider: "ollama", status: "CONNECTED", latencyMs: 12, checkedAt: minutesAgo(1) },
    models: [{ id: "ollama:qwen2.5-coder", name: "Qwen 2.5 Coder (Local)", description: "Local" }]
  }
];

interface HarnessOptions {
  fixtureId: string;
  speed: number;
}

class HarnessHost {
  private sequencer = new EventSequencer();
  private state: SessionState = createInitialSessionState();
  private timer: number | undefined;
  /** Whether the last replay pushed memory, so switching fixtures can clear it. */
  private sentMemories = false;

  constructor(private readonly deliver: (message: HostToWebviewMessage) => void) {}

  public handle(message: WebviewToHostMessage) {
    if (message.type === "request_snapshot") {
      this.deliver({ type: "session_snapshot", seq: this.sequencer.current("fixture-task"), state: this.state });
    }
    if (message.type === "webview_ready") {
      this.deliver({ type: "providers_update", providers: PROVIDERS });
      this.deliver({ type: "settings_update", defaultAutonomy: "ask", defaultModelId: PROVIDERS[0].models[0].id, experimentalUi: true });
    }
  }

  /** Replays a fixture, delivering each event the way the runtime would. */
  public play(events: AgentEvent[], speed: number, memories?: WorkspaceMemoryEntry[]) {
    this.stop();
    // Memory is not a task event; the host pushes it separately, so the harness does too. Sent
    // only when it changes something: an extra message costs an extra render pass, and that is
    // enough to move the virtualised list by a row and invalidate every unrelated baseline.
    if (memories?.length || this.sentMemories) {
      this.deliver({ type: "memory_update", entries: memories ?? [] });
      this.sentMemories = Boolean(memories?.length);
    }
    // Visual regression waits on this flag, so a screenshot is never taken mid-replay.
    delete document.body.dataset.comuHarnessSettled;
    this.state = createInitialSessionState();
    this.sequencer.reset("fixture-task");

    // Everything but the tail is delivered at once, so the harness starts in a useful state.
    const immediate = speed === 0 ? events : events.slice(0, Math.max(0, events.length - 12));
    const paced = speed === 0 ? [] : events.slice(immediate.length);

    this.emitAll(immediate);
    if (paced.length === 0) {
      this.markSettled();
      return;
    }

    let i = 0;
    this.timer = window.setInterval(() => {
      if (i >= paced.length) {
        this.stop();
        return;
      }
      this.emitAll([paced[i]]);
      i += 1;
    }, speed);
  }

  /**
   * Signals that the panel has stopped moving, so a screenshot is never taken mid-layout.
   *
   * Waiting one tick for React to commit is not enough: the activity stream is virtualised and
   * measures its rows through a ResizeObserver that runs after the commit, then scrolls to the
   * tail. How many frames that takes depends on how busy the machine is, which made the baselines
   * depend on the load the rest of the suite happened to be putting on the box. So this waits for
   * the scroller's own geometry to stop changing rather than for a fixed delay.
   */
  private markSettled() {
    const scroller = () => document.querySelector<HTMLElement>("[role='log']");
    let last = "";
    let stable = 0;
    let frames = 0;

    const check = () => {
      const el = scroller();
      const now = el ? `${el.scrollHeight}:${el.scrollTop}:${el.clientHeight}` : "none";
      stable = now === last ? stable + 1 : 0;
      last = now;
      frames += 1;
      // Three identical polls in a row, or a cap so a genuinely animating panel still settles.
      if (stable >= 3 || frames > 200) {
        document.body.dataset.comuHarnessSettled = "1";
        return;
      }
      // setTimeout rather than requestAnimationFrame: the visual suite installs a fake clock, and
      // this is the scheduling primitive already known to run under it.
      window.setTimeout(check, 0);
    };

    window.setTimeout(check, 0);
  }

  public stop() {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
      this.markSettled();
    }
  }

  private emitAll(events: AgentEvent[]) {
    if (events.length === 0) return;
    const sequenced = events.map(event => {
      this.state = reduceEvent(this.state, event);
      return this.sequencer.next("fixture-task", event);
    });
    this.deliver({ type: "session_events", events: sequenced });
  }
}

export function installHarness(options: HarnessOptions): { api: VsCodeApi; host: HarnessHost } {
  const deliver = (message: HostToWebviewMessage) => {
    window.postMessage(message, "*");
  };
  const host = new HarnessHost(deliver);
  const sent: WebviewToHostMessage[] = [];

  const api: VsCodeApi = {
    postMessage: message => {
      sent.push(message);
      console.info("[harness] webview -> host", message);
      host.handle(message);
    },
    getState: () => undefined,
    setState: () => undefined
  };

  connectToHost(api);
  const fixture = fixtureById(options.fixtureId);
  host.play(fixture.events, options.speed, fixture.memories);
  return { api, host };
}

/** The harness toolbar: fixture, theme and panel width, all reflected in the URL. */
export function HarnessControls({ host }: { host: HarnessHost }) {
  const params = new URLSearchParams(window.location.search);
  const [fixture, setFixture] = useState(params.get("fixture") ?? "running");
  const [theme, setTheme] = useState<ThemeId>((params.get("theme") as ThemeId) ?? "dark");
  const [width, setWidth] = useState(params.get("width") ?? "340");
  const [speed, setSpeed] = useState(Number(params.get("speed") ?? 120));

  useEffect(() => {
    applyHarnessTheme(theme);
  }, [theme]);

  useEffect(() => {
    const frame = document.getElementById("comu-harness-frame");
    if (frame) frame.style.width = width === "full" ? "100%" : `${width}px`;
  }, [width]);

  useEffect(() => {
    const next = new URLSearchParams({ fixture, theme, width, speed: String(speed) });
    window.history.replaceState(null, "", `?${next.toString()}`);
  }, [fixture, theme, width, speed]);

  const replay = (id: string, ms: number) => {
    const f = fixtureById(id);
    host.play(f.events, ms, f.memories);
  };

  return (
    <aside className={styles.controls}>
      <div className={styles.group}>
        <label htmlFor="h-fixture">Fixture</label>
        <select
          id="h-fixture"
          value={fixture}
          onChange={event => {
            setFixture(event.target.value);
            replay(event.target.value, speed);
          }}
        >
          {FIXTURES.map(f => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className={styles.hint}>{fixtureById(fixture).description}</p>
      </div>

      <div className={styles.group}>
        <label htmlFor="h-theme">Theme</label>
        <select id="h-theme" value={theme} onChange={event => setTheme(event.target.value as ThemeId)}>
          {HARNESS_THEMES.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.group}>
        <label htmlFor="h-width">Panel width</label>
        <select id="h-width" value={width} onChange={event => setWidth(event.target.value)}>
          <option value="280">280px (minimum)</option>
          <option value="340">340px (typical sidebar)</option>
          <option value="400">400px (wide sidebar)</option>
          <option value="900">900px (editor tab)</option>
          <option value="full">Full width</option>
        </select>
      </div>

      <div className={styles.group}>
        <label htmlFor="h-speed">Replay pace</label>
        <select
          id="h-speed"
          value={speed}
          onChange={event => {
            const ms = Number(event.target.value);
            setSpeed(ms);
            replay(fixture, ms);
          }}
        >
          <option value={0}>Instant</option>
          <option value={40}>Fast (40ms)</option>
          <option value={120}>Realistic (120ms)</option>
          <option value={400}>Slow (400ms)</option>
        </select>
        <button type="button" onClick={() => replay(fixture, speed)}>
          Replay
        </button>
      </div>
    </aside>
  );
}

export type { HarnessHost };
