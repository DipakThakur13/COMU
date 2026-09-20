import { create } from "zustand";
import type { InteractionResponse, ProviderConfig, ProviderTestResult, TaskAutonomy, TaskMode } from "@comu/protocol";
import {
  HostToWebviewMessage,
  SessionState,
  UiState,
  WebviewToHostMessage,
  applySequenced,
  applySnapshot,
  createInitialSessionState,
  needsResync
} from "@comu/ui-state";

/** The `acquireVsCodeApi` surface, satisfied by VS Code at runtime and by the dev harness shim. */
export interface VsCodeApi {
  postMessage: (message: WebviewToHostMessage) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

export interface StoreState {
  session: SessionState;
  ui: UiState;
  providers: ProviderConfig[];
  providerTests: Record<string, ProviderTestResult>;
  testingProvider?: string;
  banner?: { message: string; hint?: string };
  /**
   * The provider the settings view should scroll to and highlight, set when the host deep-links
   * into settings. Cleared once the card has been reached.
   */
  settingsTarget?: string;
  /**
   * True once the user has chosen an autonomy level in this session. The host's configured default
   * must not overwrite a deliberate choice, which is the one thing that would quietly widen what
   * COMU may do without asking.
   */
  autonomyTouched: boolean;

  applyHostMessage: (message: HostToWebviewMessage) => void;
  post: (message: WebviewToHostMessage) => void;

  setSurface: (surface: UiState["surface"]) => void;
  setDrawer: (drawer: UiState["drawer"]) => void;
  setSettingsOpen: (open: boolean) => void;
  setComposerText: (text: string) => void;
  setMode: (mode: TaskMode) => void;
  setAutonomy: (autonomy: TaskAutonomy) => void;
  setModel: (modelId: string) => void;
  toggleExpanded: (id: string) => void;
  setShowElided: (show: boolean) => void;
  submit: () => void;
  cancel: () => void;
  respondInteraction: (response: InteractionResponse) => void;
  saveProviderKey: (providerId: string, key: string, endpoint?: string) => void;
  removeProviderKey: (providerId: string) => void;
  testProvider: (providerId: string, key?: string, endpoint?: string) => void;
  openFile: (path: string) => void;
  requestDiff: (path: string) => void;
  openAllChangedFiles: () => void;
  saveCode: (content: string, suggestedPath: string) => void;
  reportTelemetry: (name: string, value: number, details?: string) => void;
  clearSettingsTarget: () => void;
  dismissBanner: () => void;
}

const initialUi: UiState = {
  surface: "activity",
  settingsOpen: false,
  composer: { text: "", mode: "AUTO", autonomy: "ask" },
  expandedActivityIds: [],
  showElided: false
};

let vscodeApi: VsCodeApi | undefined;

export function setVsCodeApi(api: VsCodeApi) {
  vscodeApi = api;
}

export const useStore = create<StoreState>((set, get) => ({
  session: createInitialSessionState(),
  ui: initialUi,
  providers: [],
  providerTests: {},
  autonomyTouched: false,

  post: message => {
    vscodeApi?.postMessage(message);
  },

  applyHostMessage: message => {
    switch (message.type) {
      case "session_snapshot":
        set({ session: applySnapshot(message.state, message.seq) });
        break;

      case "session_events": {
        let session = get().session;
        for (const sequenced of message.events) {
          session = applySequenced(session, sequenced);
          // A gap means the replica is stale: stop applying and ask for the truth.
          if (needsResync(session)) {
            get().post({ type: "request_snapshot", reason: "gap", lastSeq: session.replication.lastSeq });
            break;
          }
        }
        set({ session });
        break;
      }

      case "providers_update":
        set({ providers: message.providers });
        break;

      case "provider_test_result":
        set(state => ({
          providerTests: { ...state.providerTests, [message.providerId]: message.result },
          testingProvider: state.testingProvider === message.providerId ? undefined : state.testingProvider
        }));
        break;

      case "settings_update":
        set(state => ({
          ui: {
            ...state.ui,
            composer: {
              ...state.ui.composer,
              // A default is a starting point, not an override. Once the user has picked a level
              // this session, the host's configured default stops applying.
              autonomy: state.autonomyTouched ? state.ui.composer.autonomy : message.defaultAutonomy,
              modelId: state.ui.composer.modelId ?? message.defaultModelId
            }
          }
        }));
        break;

      case "memory_update":
        set(state => ({ session: { ...state.session, memory: message.entries } }));
        break;

      case "open_settings":
        set(state => ({ ui: { ...state.ui, settingsOpen: true }, settingsTarget: message.targetProviderId }));
        // The catalogue may have changed since it was last pushed, and this is the one view where
        // a stale credential status is actively misleading.
        get().post({ type: "request_providers" });
        break;

      case "error":
        set({ banner: { message: message.message, hint: message.hint } });
        break;

      default:
        break;
    }
  },

  setSurface: surface => set(state => ({ ui: { ...state.ui, surface } })),
  setDrawer: drawer => set(state => ({ ui: { ...state.ui, drawer: state.ui.drawer === drawer ? undefined : drawer } })),
  setSettingsOpen: settingsOpen => {
    set(state => ({ ui: { ...state.ui, settingsOpen } }));
    if (settingsOpen) get().post({ type: "request_providers" });
  },
  setComposerText: text => set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, text } } })),
  setMode: mode => set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, mode } } })),
  setModel: modelId => {
    set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, modelId } } }));
    get().post({ type: "select_model", modelId });
  },
  setAutonomy: autonomy => {
    set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, autonomy } }, autonomyTouched: true }));
    get().post({ type: "set_autonomy", autonomy });
  },
  toggleExpanded: id =>
    set(state => ({
      ui: {
        ...state.ui,
        expandedActivityIds: state.ui.expandedActivityIds.includes(id)
          ? state.ui.expandedActivityIds.filter(x => x !== id)
          : [...state.ui.expandedActivityIds, id]
      }
    })),
  setShowElided: showElided => set(state => ({ ui: { ...state.ui, showElided } })),

  submit: () => {
    const { ui, post } = get();
    const prompt = ui.composer.text.trim();
    if (!prompt || !ui.composer.modelId) return;
    post({
      type: "submit_prompt",
      prompt,
      modelId: ui.composer.modelId,
      mode: ui.composer.mode,
      autonomy: ui.composer.autonomy
    });
    set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, text: "" } } }));
  },

  cancel: () => {
    get().post({ type: "cancel_task" });
    set(state => ({ session: { ...state.session, status: "cancelling" } }));
  },

  respondInteraction: response => {
    const { session, post } = get();
    const pending = session.pendingApproval ?? session.pendingInteraction;
    if (!pending || !session.taskId) return;
    const interactionId = "interactionId" in pending ? pending.interactionId : undefined;
    if (!interactionId) return;
    post({ type: "respond_interaction", taskId: session.taskId, interactionId, response });
    // Clear optimistically: the authoritative interaction.responded event confirms it.
    set(state => ({ session: { ...state.session, pendingApproval: undefined, pendingInteraction: undefined } }));
  },

  saveProviderKey: (providerId, key, endpoint) => {
    get().post({ type: "save_provider_key", providerId, key, endpoint });
  },

  removeProviderKey: providerId => {
    get().post({ type: "remove_provider_key", providerId });
    set(state => {
      const next = { ...state.providerTests };
      delete next[providerId];
      return { providerTests: next };
    });
  },

  testProvider: (providerId, key, endpoint) => {
    set({ testingProvider: providerId });
    get().post({ type: "test_provider", providerId, key, endpoint });
  },

  openFile: path => get().post({ type: "open_file", path }),
  requestDiff: path => get().post({ type: "request_diff", path }),

  openAllChangedFiles: () => {
    const { session, post } = get();
    for (const change of session.changes) post({ type: "open_file", path: change.path });
  },

  saveCode: (content, suggestedPath) => get().post({ type: "save_code", content, suggestedPath }),

  reportTelemetry: (name, value, details) =>
    get().post({ type: "telemetry_metric", name, value: Math.round(value), details }),

  clearSettingsTarget: () => set({ settingsTarget: undefined }),

  dismissBanner: () => set({ banner: undefined })
}));

/** Wires host messages into the store and announces readiness. Returns a disposer. */
export function connectToHost(api: VsCodeApi): () => void {
  setVsCodeApi(api);
  const onMessage = (event: MessageEvent) => {
    const message = event.data as HostToWebviewMessage;
    if (message && typeof message.type === "string") {
      useStore.getState().applyHostMessage(message);
    }
  };
  window.addEventListener("message", onMessage);
  api.postMessage({ type: "webview_ready" });
  api.postMessage({ type: "request_snapshot", reason: "initial", lastSeq: -1 });
  return () => window.removeEventListener("message", onMessage);
}
