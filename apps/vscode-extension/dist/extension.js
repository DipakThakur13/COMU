"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/security/secrets.ts
var SecretManager = class _SecretManager {
  static instance;
  secretStorage;
  constructor(context) {
    this.secretStorage = context.secrets;
  }
  static initialize(context) {
    if (!_SecretManager.instance) {
      _SecretManager.instance = new _SecretManager(context);
    }
  }
  static getInstance() {
    if (!_SecretManager.instance) {
      throw new Error("SecretManager not initialized");
    }
    return _SecretManager.instance;
  }
  getSecretName(providerId) {
    return `comu.provider.${providerId}.apiKey`;
  }
  async getProviderKey(providerId) {
    return this.secretStorage.get(this.getSecretName(providerId));
  }
  async setProviderKey(providerId, key) {
    await this.secretStorage.store(this.getSecretName(providerId), key);
  }
  async clearProviderKey(providerId) {
    await this.secretStorage.delete(this.getSecretName(providerId));
  }
};

// src/runtime/runtime_client.ts
var vscode = __toESM(require("vscode"));
var RuntimeClient = class {
  get baseUrl() {
    const config = vscode.workspace.getConfiguration("comu");
    return config.get("runtime.baseUrl") || "http://localhost:3456";
  }
  async getHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    const apiKey = await SecretManager.getInstance().getProviderKey("nvidia");
    if (apiKey) {
      headers["X-NVIDIA-API-KEY"] = apiKey;
    }
    return headers;
  }
  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`);
      if (res.ok) {
        return { status: "connected" };
      }
      return { status: "disconnected", details: `Status ${res.status}` };
    } catch (error) {
      return { status: "disconnected", details: error.message };
    }
  }
  async createTask(request) {
    const res = await fetch(`${this.baseUrl}/v1/tasks`, {
      method: "POST",
      headers: await this.getHeaders(),
      body: JSON.stringify(request)
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown error");
      throw new Error(`Failed to create task: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { taskId: data.taskId, status: data.status };
  }
  async cancelTask(taskId) {
    const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: await this.getHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to cancel task: ${res.status}`);
    }
  }
  getEventStreamUrl(taskId) {
    return `${this.baseUrl}/v1/tasks/${taskId}/events`;
  }
  async pushConfig(providers) {
    const res = await fetch(`${this.baseUrl}/v1/config/providers`, {
      method: "POST",
      headers: await this.getHeaders(),
      body: JSON.stringify({ providers })
    });
    if (!res.ok) {
      console.error("Failed to push config to runtime");
    }
  }
  async getDiff(taskId, path3) {
    const res = await fetch(`${this.baseUrl}/v1/tasks/${taskId}/diff?path=${encodeURIComponent(path3)}`, {
      headers: await this.getHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to get diff: ${res.status}`);
    }
    return await res.json();
  }
};

// src/runtime/health_monitor.ts
var HealthMonitor = class {
  constructor(client, onStatusChanged) {
    this.client = client;
    this.onStatusChanged = onStatusChanged;
  }
  client;
  onStatusChanged;
  isConnected = false;
  timer = null;
  start(intervalMs = 5e3) {
    this.stop();
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  async check() {
    const health = await this.client.health();
    const nowConnected = health.status === "connected";
    if (this.isConnected !== nowConnected) {
      this.isConnected = nowConnected;
      this.onStatusChanged(this.isConnected);
    }
  }
  getConnected() {
    return this.isConnected;
  }
};

// src/runtime/sse_client.ts
var import_eventsource_parser = require("eventsource-parser");
var SSEClient = class {
  constructor(onEvent, onError) {
    this.onEvent = onEvent;
    this.onError = onError;
  }
  onEvent;
  onError;
  abortController = null;
  async connect(url, headers) {
    this.disconnect();
    this.abortController = new AbortController();
    try {
      const response = await fetch(url, {
        headers,
        signal: this.abortController.signal
      });
      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }
      if (!response.body) {
        throw new Error(`No response body`);
      }
      const parser = (0, import_eventsource_parser.createParser)({
        onEvent: (event) => {
          try {
            const parsedData = JSON.parse(event.data);
            this.onEvent(parsedData);
          } catch (err) {
            console.error("Failed to parse SSE event data", err);
          }
        }
      });
      const body = response.body;
      if (body.getReader) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } else {
        for await (const chunk of body) {
          parser.feed(chunk.toString());
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }
      this.onError(err);
    }
  }
  disconnect() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
};

// src/sessions/task_session_store.ts
var TaskSessionStore = class {
  state = {
    status: "idle",
    events: [],
    changes: []
  };
  seenEvents = /* @__PURE__ */ new Set();
  getState() {
    return this.state;
  }
  setOffline(offline) {
    if (offline && this.state.status !== "offline") {
      this.state.status = "offline";
    } else if (!offline && this.state.status === "offline") {
      this.state.status = "idle";
    }
  }
  startNewTask(taskId, prompt, modelId) {
    this.state = {
      taskId,
      prompt,
      modelId,
      status: "running",
      events: [],
      changes: []
    };
    this.seenEvents.clear();
  }
  addEvent(event) {
    const uniqueId = `${event.taskId}-${event.eventId}`;
    if (this.seenEvents.has(uniqueId)) {
      return false;
    }
    this.seenEvents.add(uniqueId);
    this.state.events.push(event);
    if (event.type === "change.created") {
      const ce = event;
      const existing = this.state.changes.find((c) => c.path === ce.path);
      if (!existing) {
        this.state.changes.push({ path: ce.path, operation: ce.operation });
      }
    } else if (event.type === "task.completed") {
      this.state.status = "completed";
    } else if (event.type === "task.failed") {
      this.state.status = "failed";
    } else if (event.type === "task.cancelled") {
      this.state.status = "cancelled";
    } else if (event.type === "tool.completed") {
      const te = event;
    }
    return true;
  }
  setFinalResponse(text) {
    this.state.finalResponse = text;
  }
};

// src/providers/chat_provider.ts
var vscode5 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var fs = __toESM(require("fs"));

// src/workspace/workspace_context.ts
var vscode2 = __toESM(require("vscode"));
var import_crypto = require("crypto");
async function getWorkspaceContext() {
  const folders = vscode2.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  let targetFolder;
  if (folders.length === 1) {
    targetFolder = folders[0];
  } else {
    const activeEditor = vscode2.window.activeTextEditor;
    if (activeEditor) {
      targetFolder = vscode2.workspace.getWorkspaceFolder(activeEditor.document.uri);
    }
    if (!targetFolder) {
      targetFolder = await vscode2.window.showWorkspaceFolderPick({ placeHolder: "Select workspace folder for COMU" });
    }
  }
  if (!targetFolder) {
    return null;
  }
  const rootPath = targetFolder.uri.fsPath;
  const workspaceId = (0, import_crypto.createHash)("sha256").update(targetFolder.uri.toString()).digest("hex").substring(0, 16);
  return {
    rootPath,
    workspaceId
  };
}

// src/workspace/editor_context.ts
var vscode3 = __toESM(require("vscode"));
function getEditorContext() {
  const openFiles = vscode3.workspace.textDocuments.filter((doc) => !doc.isUntitled && doc.uri.scheme === "file").map((doc) => doc.uri.fsPath);
  const activeEditor = vscode3.window.activeTextEditor;
  if (!activeEditor || activeEditor.document.uri.scheme !== "file") {
    return { openFiles };
  }
  const activeFile = activeEditor.document.uri.fsPath;
  let selectionContext = void 0;
  if (!activeEditor.selection.isEmpty) {
    selectionContext = {
      filePath: activeFile,
      startLine: activeEditor.selection.start.line + 1,
      startCharacter: activeEditor.selection.start.character,
      endLine: activeEditor.selection.end.line + 1,
      endCharacter: activeEditor.selection.end.character,
      text: activeEditor.document.getText(activeEditor.selection)
    };
  }
  return {
    activeFile,
    openFiles,
    selection: selectionContext
  };
}

// src/diff/diff_viewer.ts
var vscode4 = __toESM(require("vscode"));
var path = __toESM(require("path"));
var ComuDiffProvider = class {
  contents = /* @__PURE__ */ new Map();
  setContent(uri, content) {
    this.contents.set(uri.toString(), content);
  }
  provideTextDocumentContent(uri) {
    return this.contents.get(uri.toString()) || "";
  }
};
var globalDiffProvider = new ComuDiffProvider();
async function openDiff(client, taskId, targetPath) {
  try {
    const diffData = await client.getDiff(taskId, targetPath);
    const originalUri = vscode4.Uri.parse(`comu-diff:${taskId}/original/${targetPath}`);
    const newUri = vscode4.Uri.parse(`comu-diff:${taskId}/modified/${targetPath}`);
    globalDiffProvider.setContent(originalUri, diffData.originalContent || "");
    globalDiffProvider.setContent(newUri, diffData.newContent || "");
    const title = `COMU Diff: ${path.basename(targetPath)}`;
    await vscode4.commands.executeCommand("vscode.diff", originalUri, newUri, title);
  } catch (err) {
    vscode4.window.showErrorMessage(`Failed to open diff: ${err.message}`);
  }
}

// src/providers/chat_provider.ts
var ChatViewProvider = class {
  constructor(_extensionUri, runtimeClient, sessionStore, sseClient, providerManager) {
    this._extensionUri = _extensionUri;
    this.runtimeClient = runtimeClient;
    this.sessionStore = sessionStore;
    this.sseClient = sseClient;
    this.providerManager = providerManager;
  }
  _extensionUri;
  runtimeClient;
  sessionStore;
  sseClient;
  providerManager;
  static viewType = "comu.chatView";
  _view;
  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "ready":
          this.sendStateToWebview();
          break;
        case "submit_prompt":
          await this.handleSubmitPrompt(data.prompt, data.modelId);
          break;
        case "cancel_task":
          await this.handleCancelTask();
          break;
        case "request_diff":
          await this.handleRequestDiff(data.path);
          break;
        case "request_providers":
          await this.sendProvidersToWebview();
          break;
        case "save_provider_key":
          await this.providerManager.setProviderKey(data.providerId, data.key);
          await this.sendProvidersToWebview();
          await this.pushConfigToRuntime();
          break;
        case "remove_provider_key":
          await this.providerManager.setProviderKey(data.providerId, "");
          await this.sendProvidersToWebview();
          await this.pushConfigToRuntime();
          break;
        case "test_provider":
          vscode5.window.showInformationMessage(`Connection to ${data.providerId} successful!`);
          break;
      }
    });
  }
  async sendProvidersToWebview() {
    if (this._view) {
      const providers = await this.providerManager.getProvidersState();
      const msg = { type: "providers_update", providers };
      this._view.webview.postMessage(msg);
    }
  }
  async pushConfigToRuntime() {
    const config = await this.providerManager.getRawConfig();
    await this.runtimeClient.pushConfig(config);
  }
  async handleSubmitPrompt(prompt, modelId) {
    if (!prompt) return;
    const workspaceCtx = await getWorkspaceContext();
    if (!workspaceCtx) {
      vscode5.window.showErrorMessage("Open a workspace or select a valid workspace folder to use COMU.");
      return;
    }
    const editorCtx = getEditorContext();
    try {
      const taskInfo = await this.runtimeClient.createTask({
        taskId: `task-${Date.now()}`,
        prompt,
        modelId,
        workspace: workspaceCtx,
        editor: editorCtx
      });
      this.sessionStore.startNewTask(taskInfo.taskId, prompt, modelId);
      this.sendStateToWebview();
      const url = this.runtimeClient.getEventStreamUrl(taskInfo.taskId);
      const headers = await this.runtimeClient.getHeaders();
      await this.sseClient.connect(url, headers);
    } catch (e) {
      this.sendErrorToWebview(`Failed to start task: ${e.message}`);
    }
  }
  async handleCancelTask() {
    const state = this.sessionStore.getState();
    if (state.taskId && state.status === "running") {
      try {
        await this.runtimeClient.cancelTask(state.taskId);
      } catch (e) {
        vscode5.window.showErrorMessage(`Cancel failed: ${e.message}`);
      }
    }
  }
  async handleRequestDiff(targetPath) {
    const state = this.sessionStore.getState();
    if (state.taskId) {
      await openDiff(this.runtimeClient, state.taskId, targetPath);
    }
  }
  sendStateToWebview() {
    if (this._view) {
      const msg = { type: "state_update", state: this.sessionStore.getState() };
      this._view.webview.postMessage(msg);
    }
  }
  sendErrorToWebview(message) {
    if (this._view) {
      const msg = { type: "error", message };
      this._view.webview.postMessage(msg);
    }
  }
  _getHtmlForWebview(webview) {
    const htmlPath = path2.join(this._extensionUri.fsPath, "src", "webview", "index.html");
    let html = fs.readFileSync(htmlPath, "utf8");
    const stylePath = webview.asWebviewUri(vscode5.Uri.joinPath(this._extensionUri, "src", "webview", "style.css"));
    const scriptPath = webview.asWebviewUri(vscode5.Uri.joinPath(this._extensionUri, "src", "webview", "main.js"));
    html = html.replace('href="style.css"', `href="${stylePath}"`);
    html = html.replace('src="main.js"', `src="${scriptPath}"`);
    return html;
  }
};

// src/providers/provider_manager.ts
var ProviderManager = class _ProviderManager {
  static SUPPORTED_PROVIDERS = [
    {
      id: "nvidia",
      displayName: "NVIDIA",
      models: [
        { id: "nvidia-nemotron-3-ultra", name: "Nemotron 3 Ultra" }
      ]
    },
    {
      id: "openai",
      displayName: "OpenAI",
      models: []
    },
    {
      id: "anthropic",
      displayName: "Anthropic",
      models: []
    },
    {
      id: "ollama",
      displayName: "Ollama",
      models: [
        { id: "ollama-llama-3", name: "Llama 3 (Local)" }
      ],
      isLocal: true
    }
  ];
  async getProvidersState() {
    const secrets = SecretManager.getInstance();
    const state = [];
    for (const p of _ProviderManager.SUPPORTED_PROVIDERS) {
      let configured = false;
      if (p.isLocal) {
        configured = true;
      } else {
        const key = await secrets.getProviderKey(p.id);
        configured = !!key;
      }
      state.push({
        ...p,
        configured
      });
    }
    return state;
  }
  async setProviderKey(providerId, key) {
    if (!key) {
      await SecretManager.getInstance().clearProviderKey(providerId);
    } else {
      await SecretManager.getInstance().setProviderKey(providerId, key);
    }
  }
  async getRawConfig() {
    const secrets = SecretManager.getInstance();
    const config = {};
    for (const p of _ProviderManager.SUPPORTED_PROVIDERS) {
      if (!p.isLocal) {
        const key = await secrets.getProviderKey(p.id);
        if (key) {
          config[p.id] = { apiKey: key };
        }
      } else {
        config[p.id] = {};
      }
    }
    return config;
  }
};

// src/extension.ts
function activate(context) {
  console.log("COMU AI Coding Agent is now active!");
  SecretManager.initialize(context);
  const runtimeClient = new RuntimeClient();
  const sessionStore = new TaskSessionStore();
  const providerManager = new ProviderManager();
  let chatProvider;
  const sseClient = new SSEClient(
    (event) => {
      const added = sessionStore.addEvent(event);
      if (added && chatProvider) {
        chatProvider.sendStateToWebview();
      }
    },
    (error) => {
      console.error("SSE Error:", error);
      if (chatProvider) {
        chatProvider.sendErrorToWebview(`Connection dropped: ${error.message}`);
      }
    }
  );
  chatProvider = new ChatViewProvider(context.extensionUri, runtimeClient, sessionStore, sseClient, providerManager);
  const healthMonitor = new HealthMonitor(runtimeClient, async (connected) => {
    sessionStore.setOffline(!connected);
    if (connected) {
      const config = await providerManager.getRawConfig();
      await runtimeClient.pushConfig(config);
    }
    chatProvider.sendStateToWebview();
  });
  healthMonitor.start();
  context.subscriptions.push(
    vscode6.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
  );
  context.subscriptions.push(
    vscode6.commands.registerCommand("comu.openChat", () => {
      vscode6.commands.executeCommand("workbench.view.extension.comu-sidebar");
    })
  );
  context.subscriptions.push(
    vscode6.workspace.registerTextDocumentContentProvider("comu-diff", globalDiffProvider)
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
