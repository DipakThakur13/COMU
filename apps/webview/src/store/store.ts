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
              autonomy: message.defaultAutonomy,
              modelId: state.ui.composer.modelId ?? message.defaultModelId
            }
          }
        }));
        break;

      case "memory_update":
        set(state => ({ session: { ...state.session, memory: message.entries } }));
        break;

      case "open_settings":
        set(state => ({ ui: { ...state.ui, settingsOpen: true } }));
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
  setSettingsOpen: settingsOpen => set(state => ({ ui: { ...state.ui, settingsOpen } })),
  setComposerText: text => set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, text } } })),
  setMode: mode => set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, mode } } })),
  setModel: modelId => {
    set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, modelId } } }));
    get().post({ type: "select_model", modelId });
  },
  setAutonomy: autonomy => {
    set(state => ({ ui: { ...state.ui, composer: { ...state.ui.composer, autonomy } } }));
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
