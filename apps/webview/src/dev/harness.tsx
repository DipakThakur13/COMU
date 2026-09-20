import { useEffect, useState } from "react";
import type { AgentEvent, ProviderConfig } from "@comu/protocol";
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

const PROVIDERS: ProviderConfig[] = [
  {
    providerId: "nvidia",
    displayName: "NVIDIA",
    enabled: true,
    hasCredential: true,
    isLocal: false,
    status: "CONNECTED",
    models: [
      { id: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning", description: "Fast agent" },
      { id: "moonshotai/kimi-k3", name: "Kimi K3", description: "Frontier coding" }
    ]
  },
  {
    providerId: "ollama",
    displayName: "Ollama (Local)",
    enabled: true,
    hasCredential: true,
    isLocal: true,
    status: "CONNECTED",
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
  public play(events: AgentEvent[], speed: number) {
    this.stop();
    this.state = createInitialSessionState();
    this.sequencer.reset("fixture-task");

    // Everything but the tail is delivered at once, so the harness starts in a useful state.
    const immediate = speed === 0 ? events : events.slice(0, Math.max(0, events.length - 12));
    const paced = speed === 0 ? [] : events.slice(immediate.length);

    this.emitAll(immediate);
    if (paced.length === 0) return;

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

  public stop() {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
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
  host.play(fixtureById(options.fixtureId).events, options.speed);
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
    host.play(fixtureById(id).events, ms);
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
