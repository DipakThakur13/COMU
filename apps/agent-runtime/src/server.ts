import express, { Express, Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import cors from 'cors';
import { resolve, isAbsolute } from 'path';
import { statSync, realpathSync } from 'fs';
import { ToolRegistry, ToolExecutor } from '@comu/tool-core';
import { ReadFileTool, ListDirectoryTool, GetWorkspaceTreeTool, CreateFileTool, WriteFileTool, EditFileTool } from '@comu/tool-filesystem';
import { SearchTextTool, NodeRecursiveSearchBackend } from '@comu/tool-search';
import { TerminalTool } from '@comu/terminal';
import { GitStatusTool, GitDiffTool, GitCreateBranchTool, GitStageFilesTool, GitCommitTool, GitPushTool } from '@comu/git';
import { RunTestsTool, RunBuildTool, RunLinterTool, RunTypecheckTool } from '@comu/validation';
import { WebDocsTool } from '@comu/tool-web-docs';
import { AgentOrchestrator, OrchestratorContext, InteractionManager, SubagentManager } from '@comu/agent-core';
import { TaskPlanner } from '@comu/planning-engine';
import { VerificationEngine } from '@comu/verification-engine';
import { RepairEngine } from '@comu/repair-engine';
import { ComuDiffEngine } from '@comu/diff-engine';
import { MemoryEngine } from '@comu/memory-engine';
import { NvidiaProvider, NvidiaModelCatalog } from '@comu/provider-nvidia';
import {
  ModelProvider,
  OpenAICompatibleProvider,
  OllamaProvider,
  ASTRA_CAPABILITY_PROFILE
} from '@comu/model-core';
import { AgentEvent, ProviderConfig, TaskMode, TASK_MODES, TaskAutonomy, TASK_AUTONOMY_LEVELS } from '@comu/protocol';
import { InMemoryTaskEventStore } from './event_store.js';
import { appendTurn, buildTurnContext, loadSession, recordCheckpoint, relativePath, type TurnContext } from '@comu/session-store';
import { turnFromTask, type FinishedTask } from './session_turns.js';

export type ProviderFactory = (selection: ProviderSelection, config: Record<string, any>) => ModelProvider;

export interface RuntimeServerOptions {
  /** Test seam: replaces provider construction for the task runner. */
  providerFactory?: ProviderFactory;
  /**
   * Per-session bearer token. When set, every route requires it. The extension generates one
   * per spawned runtime and passes it through the COMU_RUNTIME_TOKEN environment variable.
   */
  authToken?: string;
  /** Browser origins allowed by CORS. Defaults to VS Code webview origins only. */
  allowedOriginPattern?: RegExp;
  /** Bounded wait for approval decisions; expiry is a denial. Defaults to COMU_APPROVAL_TIMEOUT_MS or 10 minutes. */
  approvalTimeoutMs?: number;
  /** Grace period for an event stream subscriber to attach before a task counts as headless. Defaults to 3 seconds. */
  approvalObserverGraceMs?: number;
  /** Where session files live. Defaults to the app data directory, beside the memory store. */
  sessionStoreDir?: string;
}

export const AUTH_HEADER = 'authorization';
export const AUTH_TOKEN_HEADER = 'x-comu-token';
export const DEFAULT_ALLOWED_ORIGIN = /^vscode-webview:\/\//i;
export const LOOPBACK_HOST = '127.0.0.1';

/** Constant-time comparison that does not leak length information. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function generateRuntimeToken(): string {
  return randomBytes(32).toString('hex');
}

export function extractPresentedToken(req: Request): string | undefined {
  const explicit = req.headers[AUTH_TOKEN_HEADER];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const auth = req.headers[AUTH_HEADER];
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return undefined;
}

export function createAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const presented = extractPresentedToken(req);
    if (!safeEqual(presented, token)) {
      res.status(401).json({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED', message: 'Missing or invalid runtime token.' });
      return;
    }
    next();
  };
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const addr = address.toLowerCase();
  if (addr === '::1' || addr === '::ffff:127.0.0.1' || addr === 'localhost') return true;
  if (addr.startsWith('::ffff:')) return isLoopbackAddress(addr.slice('::ffff:'.length));
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

/** Defence in depth: even if the socket were bound more widely, refuse non-loopback peers. */
export function createLoopbackGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({ error: 'NON_LOOPBACK_REJECTED', code: 'NON_LOOPBACK_REJECTED', message: 'The COMU runtime only accepts loopback connections.' });
      return;
    }
    next();
  };
}

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not observe the promise an async handler returns: a rejection leaves the request
 * hanging with no response. Wrap every async route so rejections reach the JSON error handler.
 */
export function asyncRoute(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

/** Terminal error middleware: always answer with JSON, never Express's default HTML page. */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[COMU runtime] Unhandled route error:', err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR', code: 'INTERNAL_ERROR', message });
}

/** Binds the runtime to the loopback interface only. */
export function startRuntimeServer(app: Express, port: number | string, host: string = LOOPBACK_HOST): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(Number(port), host, () => resolvePromise(server));
    server.once('error', reject);
  });
}

export interface ProviderSelection {
  modelId: string;
  providerId: 'nvidia' | 'experiential' | 'openai' | 'ollama' | 'unknown';
}

export function selectProvider(modelId: string): ProviderSelection {
  const lower = (modelId || '').toLowerCase();
  if (OllamaProvider.isOllamaModelId(lower)) {
    return { modelId, providerId: 'ollama' };
  }
  // By the catalogue, not by substring. "nvidia-nemotron-3-ultra" contains "nemotron" and used to
  // route here, where the provider silently replaced it with its default; moonshotai/kimi-k3 is an
  // NVIDIA model that contains none of the old keywords and was refused.
  if (NvidiaModelCatalog.has(modelId)) {
    return { modelId, providerId: 'nvidia' };
  }
  if (lower.includes('experiential') || lower.includes('astra')) {
    return { modelId, providerId: 'experiential' };
  }
  if (lower.includes('openai') || lower.includes('gpt-4')) {
    return { modelId, providerId: 'openai' };
  }
  return { modelId, providerId: 'unknown' };
}

export type WorkspaceResolution =
  | { ok: true; rootPath: string; workspaceId?: string }
  | { ok: false; code: 'WORKSPACE_REQUIRED' | 'WORKSPACE_INVALID'; message: string };

/**
 * The task request's workspace is the only authority for where the agent operates.
 * The runtime's own process.cwd() is the extension host's directory, never the user's project.
 */
export function resolveWorkspaceRoot(workspace: unknown): WorkspaceResolution {
  const ws = workspace as { rootPath?: unknown; workspaceId?: unknown } | undefined;
  const raw = ws && typeof ws.rootPath === 'string' ? ws.rootPath.trim() : '';
  if (!raw) {
    return { ok: false, code: 'WORKSPACE_REQUIRED', message: 'Task request must include workspace.rootPath.' };
  }
  if (!isAbsolute(raw)) {
    return { ok: false, code: 'WORKSPACE_INVALID', message: `workspace.rootPath must be an absolute path (received '${raw}').` };
  }
  let rootPath: string;
  try {
    rootPath = realpathSync(resolve(raw));
    if (!statSync(rootPath).isDirectory()) {
      return { ok: false, code: 'WORKSPACE_INVALID', message: `workspace.rootPath is not a directory: ${raw}` };
    }
  } catch {
    return { ok: false, code: 'WORKSPACE_INVALID', message: `workspace.rootPath does not exist or is not accessible: ${raw}` };
  }
  const workspaceId = ws && typeof ws.workspaceId === 'string' && ws.workspaceId.trim() ? ws.workspaceId.trim() : undefined;
  return { ok: true, rootPath, workspaceId };
}

/**
 * The execution budget a task runs under when the caller asks for nothing else.
 *
 * These are the values COMU has always shipped. They are exported so that anything measuring the
 * agent can record which budget a run used, rather than assuming.
 */
export const DEFAULT_AGENT_LIMITS = {
  maxSteps: 30,
  maxToolCalls: 100,
  maxExecutionTimeMs: 5 * 60 * 1000,
  maxRepairAttempts: 3,
  maxValidationRuns: 6,
  maxRepairFiles: 5,
  maxRepairTimeMs: 180_000,
  modelRequestTimeoutMs: 120_000
} as const;

/**
 * Ceilings on what a caller may ask for.
 *
 * A budget is not a security boundary, so these are generous. They exist so that a typo cannot
 * wedge the runtime on a task that will never end, and so an overridable limit stays a limit.
 */
const MAX_AGENT_LIMITS: Record<keyof typeof DEFAULT_AGENT_LIMITS, number> = {
  maxSteps: 1000,
  maxToolCalls: 5000,
  maxExecutionTimeMs: 2 * 60 * 60 * 1000,
  maxRepairAttempts: 20,
  maxValidationRuns: 50,
  maxRepairFiles: 100,
  maxRepairTimeMs: 30 * 60 * 1000,
  modelRequestTimeoutMs: 15 * 60 * 1000
};

export type TaskLimitsResolution =
  | { ok: true; limits: typeof DEFAULT_AGENT_LIMITS }
  | { ok: false; message: string };

/**
 * Merges a caller's requested budget over the defaults.
 *
 * The five minute default is right for someone watching a panel and wrong for a long refactor, so
 * it is a parameter rather than a constant. Anything a benchmark measures under a raised budget
 * has to say so, which is why the resolved budget is reported back on the task.
 */
export function resolveTaskLimits(requested: unknown): TaskLimitsResolution {
  if (requested === undefined || requested === null) {
    return { ok: true, limits: { ...DEFAULT_AGENT_LIMITS } };
  }
  if (typeof requested !== 'object' || Array.isArray(requested)) {
    return { ok: false, message: 'limits must be an object.' };
  }

  const limits: Record<string, number> = { ...DEFAULT_AGENT_LIMITS };
  for (const [key, value] of Object.entries(requested as Record<string, unknown>)) {
    if (!(key in DEFAULT_AGENT_LIMITS)) {
      return { ok: false, message: `Unknown limit '${key}'. Allowed: ${Object.keys(DEFAULT_AGENT_LIMITS).join(', ')}.` };
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return { ok: false, message: `limits.${key} must be a positive integer (received ${JSON.stringify(value)}).` };
    }
    const ceiling = MAX_AGENT_LIMITS[key as keyof typeof DEFAULT_AGENT_LIMITS];
    if (value > ceiling) {
      return { ok: false, message: `limits.${key} must not exceed ${ceiling} (received ${value}).` };
    }
    limits[key] = value;
  }
  return { ok: true, limits: limits as unknown as typeof DEFAULT_AGENT_LIMITS };
}

export function defaultProviderFactory(selection: ProviderSelection, providers: Record<string, any>): ModelProvider {
  const { modelId, providerId } = selection;
  if (providerId === 'ollama') {
    // Local inference. No API key, no cloud endpoint, never falls through to NVIDIA.
    return new OllamaProvider(providers?.['ollama']?.endpoint, modelId);
  }
  if (providerId === 'experiential') {
    const key = providers?.['experiential']?.apiKey || process.env.EXPERIENTIAL_API_KEY;
    const endpoint = providers?.['experiential']?.endpoint;
    return new OpenAICompatibleProvider(key, endpoint, 'gpt-6-astra', ASTRA_CAPABILITY_PROFILE);
  }
  if (providerId === 'openai') {
    const key = providers?.['openai']?.apiKey || process.env.OPENAI_API_KEY;
    const endpoint = providers?.['openai']?.endpoint;
    return new OpenAICompatibleProvider(key, endpoint, modelId);
  }
  if (providerId === 'nvidia') {
    const nvidiaKey = providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY;
    const nvidiaEndpoint = providers?.['nvidia']?.endpoint;
    // The requested model, every time. Without it the provider fell back to its built-in default
    // and every NVIDIA request went to Lightning 30B-A3B whatever the user chose.
    return new NvidiaProvider(nvidiaKey, nvidiaEndpoint, modelId);
  }
  // No silent fallback to NVIDIA: an id no provider recognises is refused at task creation.
  throw new Error(`No provider serves model '${modelId}'.`);
}

/** What the runtime accepts as a model id, for a refusal that tells the caller what to send instead. */
function describeAcceptedModels(): string {
  const nvidia = NvidiaModelCatalog.list().map(m => m.id).join(', ');
  return (
    `NVIDIA: ${nvidia}. Experiential Labs: gpt-6-astra. ` +
    `OpenAI-compatible: an id containing "gpt-4" or "openai", such as gpt-4o. Local: ollama:<model>, such as ollama:llama3.1.`
  );
}

/**
 * The tool registry the runtime ships. Exported so the conformance suite covers exactly the tools
 * a task can actually call, rather than a list that has to be kept in step by hand.
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(ReadFileTool);
  registry.register(ListDirectoryTool);
  registry.register(GetWorkspaceTreeTool);
  registry.register(CreateFileTool);
  registry.register(WriteFileTool);
  registry.register(EditFileTool);
  registry.register(new TerminalTool());
  registry.register(new GitStatusTool());
  registry.register(new GitDiffTool());
  registry.register(new GitCreateBranchTool());
  registry.register(new GitStageFilesTool());
  registry.register(new GitCommitTool());
  registry.register(new GitPushTool());
  registry.register(new RunTestsTool());
  registry.register(new RunBuildTool());
  registry.register(new RunLinterTool());
  registry.register(new RunTypecheckTool());
  registry.register(new WebDocsTool());

  // Register search tool with backend
  const searchBackend = new NodeRecursiveSearchBackend();
  registry.register({
    ...SearchTextTool,
    execute: async (args, ctx) => SearchTextTool.execute(args, { ...ctx, searchBackend } as any)
  });
  return registry;
}



export function createRuntimeApp(options: RuntimeServerOptions = {}): Express {
const providerFactory: ProviderFactory = options.providerFactory || defaultProviderFactory;
const approvalTimeoutMs = options.approvalTimeoutMs
  ?? (Number(process.env.COMU_APPROVAL_TIMEOUT_MS) > 0 ? Number(process.env.COMU_APPROVAL_TIMEOUT_MS) : 10 * 60 * 1000);

const allowedOrigin = options.allowedOriginPattern || DEFAULT_ALLOWED_ORIGIN;

const app: Express = express();
app.use(createLoopbackGuard());
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (the extension host) send no Origin; CORS does not apply to them.
    if (!origin) return callback(null, false);
    callback(null, allowedOrigin.test(origin));
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'X-COMU-Token'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
if (options.authToken) {
  app.use(createAuthMiddleware(options.authToken));
}
app.use(express.json());

const registry = createToolRegistry();

const executor = new ToolExecutor(registry);
const diffEngine = new ComuDiffEngine();
const interactionManager = new InteractionManager();
const memoryEngine = new MemoryEngine();
const subagentManager = new SubagentManager();

// Global config state
let runtimeConfig = {
  providers: {} as Record<string, any>
};

// Global SSE connection tracking and event store
const eventStreams = new Map<string, express.Response[]>();
const eventStore = new InMemoryTaskEventStore({ maxEventsPerTask: 5000 });
const taskChangeSets = new Map<string, any>();
const taskControllers = new Map<string, AbortController>();
const finishedTasks = new Set<string>();

/**
 * The context a new turn in this workspace is built from. A session that cannot be read never
 * stops the task: it runs as a first turn, and the reason is logged.
 */
const sessionContextFor = (workspaceRoot: string): TurnContext | undefined => {
  try {
    return buildTurnContext(loadSession(workspaceRoot, { baseDir: options.sessionStoreDir }));
  } catch (e: any) {
    console.error(`The session for ${workspaceRoot} could not be read; this turn starts without it: ${e?.message || e}`);
    return undefined;
  }
};

/** Every credential this runtime holds, so none of them can be written into a session file. */
const heldSecrets = (): string[] => [
  ...Object.values(runtimeConfig.providers).map((p: any) => p?.apiKey).filter((k): k is string => typeof k === 'string'),
  ...['NVIDIA_API_KEY', 'OPENAI_API_KEY', 'EXPERIENTIAL_API_KEY'].map(name => process.env[name]).filter((k): k is string => !!k)
];

app.post(['/v1/config/providers', '/v1/config'], (req, res) => {
  const providers = req.body.providers || req.body.config;
  if (providers) {
    runtimeConfig.providers = providers;
    res.status(200).json({ status: "ok" });
  } else {
    res.status(400).json({ error: "Missing providers config" });
  }
});

const OLLAMA_SUGGESTED_MODELS = [
  { id: 'ollama:llama3.1', name: 'Llama 3.1 (Local)', description: 'Run `ollama pull llama3.1`' },
  { id: 'ollama:qwen2.5-coder', name: 'Qwen 2.5 Coder (Local)', description: 'Run `ollama pull qwen2.5-coder`' },
  { id: 'ollama:deepseek-coder-v2', name: 'DeepSeek Coder V2 (Local)', description: 'Run `ollama pull deepseek-coder-v2`' }
];

async function describeOllama(): Promise<ProviderConfig> {
  const endpoint = OllamaProvider.normalizeBaseUrl(runtimeConfig.providers?.['ollama']?.endpoint);
  const probe = await OllamaProvider.probe(endpoint, 1500);
  let models = OLLAMA_SUGGESTED_MODELS;
  if (probe.status === 'CONNECTED') {
    try {
      const installed = await OllamaProvider.listModels(endpoint, 1500);
      if (installed.length > 0) {
        models = installed.map(m => ({
          id: m.id,
          name: `${m.name} (Local)`,
          description: [m.family, m.parameterSize].filter(Boolean).join(' · ') || 'Installed Ollama model'
        }));
      }
    } catch {
      // keep suggestions
    }
  }
  return {
    providerId: 'ollama',
    displayName: 'Ollama (Local)',
    enabled: true,
    endpoint,
    selectedModel: models[0]?.name,
    hasCredential: true,
    isLocal: true,
    status: probe.status,
    models,
    description: probe.status === 'CONNECTED'
      ? 'Local on-device inference through Ollama. No API key, no external network calls.'
      : (probe.message || 'Ollama is not reachable.')
  };
}

// Safe Provider Configuration List (No API Keys returned)
app.get('/v1/config/providers', asyncRoute(async (req, res) => {
  const envNvidia = NvidiaProvider.detectEnvironmentCredential();
  const hasNvidiaKey = !!(runtimeConfig.providers?.['nvidia']?.apiKey || envNvidia);

  const envExperiential = OpenAICompatibleProvider.detectEnvironmentCredential('experiential');
  const hasExperientialKey = !!(runtimeConfig.providers?.['experiential']?.apiKey || envExperiential);

  const envOpenAI = OpenAICompatibleProvider.detectEnvironmentCredential('openai');
  const hasOpenAIKey = !!(runtimeConfig.providers?.['openai']?.apiKey || envOpenAI);

  const providers: ProviderConfig[] = [
    {
      providerId: 'nvidia',
      displayName: 'NVIDIA',
      enabled: true,
      endpoint: runtimeConfig.providers?.['nvidia']?.endpoint || NvidiaProvider.DEFAULT_ENDPOINT,
      hasCredential: hasNvidiaKey,
      isLocal: false,
      status: hasNvidiaKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      environmentDetected: envNvidia,
      // The catalogue the provider validates against, so every id listed here is one a task accepts.
      models: NvidiaModelCatalog.list().map(m => ({ id: m.id, name: m.displayName })),
      description: 'High performance cloud inference powered by NVIDIA Nemotron'
    },
    {
      providerId: 'experiential',
      displayName: 'GPT-6 Astra (Experiential Labs)',
      enabled: true,
      endpoint: runtimeConfig.providers?.['experiential']?.endpoint || ASTRA_CAPABILITY_PROFILE.defaultEndpoint,
      selectedModel: 'gpt-6-astra',
      hasCredential: hasExperientialKey,
      isLocal: false,
      status: hasExperientialKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      environmentDetected: envExperiential,
      models: [
        { id: 'gpt-6-astra', name: 'GPT-6 Astra', description: 'Experiential Labs 1.05M context frontier model' }
      ],
      description: 'Experiential Labs OpenAI-compatible gateway powered by GPT-6 Astra'
    },
    {
      providerId: 'openai',
      displayName: 'OpenAI-Compatible',
      enabled: true,
      endpoint: runtimeConfig.providers?.['openai']?.endpoint || 'https://api.openai.com/v1',
      selectedModel: 'gpt-4o',
      hasCredential: hasOpenAIKey,
      isLocal: false,
      status: hasOpenAIKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      environmentDetected: envOpenAI,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI multimodal flagship' }
      ],
      description: 'Connect any OpenAI-compatible API endpoint with your own API key'
    },
    await describeOllama()
  ];
  res.status(200).json({ providers });
}));

// Safe Single Provider Status (No API Key returned)
app.get('/v1/config/providers/:providerId/status', asyncRoute(async (req, res) => {
  const { providerId } = req.params;
  if (providerId === 'nvidia') {
    const envNvidia = NvidiaProvider.detectEnvironmentCredential();
    const hasKey = !!(runtimeConfig.providers?.['nvidia']?.apiKey || envNvidia);
    return res.status(200).json({
      providerId: 'nvidia',
      hasCredential: hasKey,
      environmentDetected: envNvidia,
      status: hasKey ? 'CONNECTED' : 'NOT_CONFIGURED'
    });
  } else if (providerId === 'experiential' || providerId === 'gpt-6-astra') {
    const envExp = OpenAICompatibleProvider.detectEnvironmentCredential('experiential');
    const hasKey = !!(runtimeConfig.providers?.['experiential']?.apiKey || envExp);
    return res.status(200).json({
      providerId: 'experiential',
      hasCredential: hasKey,
      environmentDetected: envExp,
      status: hasKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      selectedModel: 'gpt-6-astra'
    });
  } else if (providerId === 'openai') {
    const envOpenAI = OpenAICompatibleProvider.detectEnvironmentCredential('openai');
    const hasKey = !!(runtimeConfig.providers?.['openai']?.apiKey || envOpenAI);
    return res.status(200).json({
      providerId: 'openai',
      hasCredential: hasKey,
      environmentDetected: envOpenAI,
      status: hasKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      selectedModel: 'gpt-4o'
    });
  } else if (providerId === 'ollama') {
    const described = await describeOllama();
    return res.status(200).json({
      providerId: 'ollama',
      hasCredential: true,
      status: described.status,
      endpoint: described.endpoint,
      selectedModel: described.selectedModel,
      message: described.description
    });
  }
  res.status(404).json({ error: `Provider '${providerId}' not found` });
}));

// Test Connection Endpoint
app.post('/v1/config/providers/:providerId/test', asyncRoute(async (req, res) => {
  const { providerId } = req.params;
  if (providerId === 'nvidia') {
    const key = req.body?.apiKey || runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY;
    const endpoint = req.body?.endpoint || runtimeConfig.providers?.['nvidia']?.endpoint || NvidiaProvider.DEFAULT_ENDPOINT;
    if (!key) {
      return res.status(200).json({
        provider: 'nvidia',
        status: 'NOT_CONFIGURED',
        message: 'No NVIDIA API key configured.'
      });
    }
    const testResult = await NvidiaProvider.testConnection(key, endpoint);
    return res.status(200).json(testResult);
  } else if (providerId === 'experiential' || providerId === 'gpt-6-astra') {
    const key = req.body?.apiKey || runtimeConfig.providers?.['experiential']?.apiKey || process.env.EXPERIENTIAL_API_KEY;
    const endpoint = req.body?.endpoint || runtimeConfig.providers?.['experiential']?.endpoint;
    if (!key) {
      return res.status(200).json({
        provider: 'experiential',
        status: 'NOT_CONFIGURED',
        message: 'No Experiential Labs API key configured.'
      });
    }
    const testResult = await OpenAICompatibleProvider.testConnection(key, endpoint, undefined, 'gpt-6-astra', ASTRA_CAPABILITY_PROFILE);
    return res.status(200).json(testResult);
  } else if (providerId === 'openai') {
    const key = req.body?.apiKey || runtimeConfig.providers?.['openai']?.apiKey || process.env.OPENAI_API_KEY;
    const endpoint = req.body?.endpoint || runtimeConfig.providers?.['openai']?.endpoint;
    if (!key) {
      return res.status(200).json({
        provider: 'openai',
        status: 'NOT_CONFIGURED',
        message: 'No OpenAI API key configured.'
      });
    }
    const testResult = await OpenAICompatibleProvider.testConnection(key, endpoint, undefined, req.body?.model || 'gpt-4o');
    return res.status(200).json(testResult);
  } else if (providerId === 'ollama') {
    const endpoint = req.body?.endpoint || runtimeConfig.providers?.['ollama']?.endpoint;
    const testResult = await OllamaProvider.probe(endpoint);
    return res.status(200).json(testResult);
  }
  res.status(404).json({ error: `Provider '${providerId}' not testable` });
}));

// Basic health check
app.get("/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post('/v1/tasks', asyncRoute(async (req, res) => {
  const taskReq = req.body || {};

  // Model Guard: a task names its model. The runtime never picks one on the caller's behalf: the
  // old fallback id was not in any catalogue, and the provider then quietly substituted its own.
  if (typeof taskReq.modelId !== 'string' || !taskReq.modelId.trim()) {
    return res.status(400).json({
      error: 'MODEL_REQUIRED',
      code: 'MODEL_REQUIRED',
      message: `Choose a model before starting a task. Accepted: ${describeAcceptedModels()}`
    });
  }
  const modelId: string = taskReq.modelId.trim();
  const selection = selectProvider(modelId);

  // With the built-in providers, an id none of them serves is refused rather than routed somewhere.
  // An injected providerFactory (tests, the benchmark self test) owns its own model ids.
  if (!options.providerFactory && selection.providerId === 'unknown') {
    return res.status(400).json({
      error: 'UNKNOWN_MODEL',
      code: 'UNKNOWN_MODEL',
      message: `Unknown model '${modelId}'. Accepted: ${describeAcceptedModels()}`
    });
  }

  // Task-Start Guard: verify provider credential exists before task launch
  if (selection.providerId === 'nvidia') {
    const hasNvidia = !!(runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY);
    if (!hasNvidia) {
      return res.status(400).json({
        error: 'PROVIDER_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        providerId: 'nvidia',
        message: 'Connect your NVIDIA API key before starting this task.'
      });
    }
  } else if (selection.providerId === 'experiential') {
    const hasExperiential = !!(runtimeConfig.providers?.['experiential']?.apiKey || process.env.EXPERIENTIAL_API_KEY);
    if (!hasExperiential) {
      return res.status(400).json({
        error: 'PROVIDER_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        providerId: 'experiential',
        message: 'Connect your Experiential Labs API key for GPT-6 Astra before starting this task.'
      });
    }
  } else if (selection.providerId === 'openai') {
    const hasOpenAI = !!(runtimeConfig.providers?.['openai']?.apiKey || process.env.OPENAI_API_KEY);
    if (!hasOpenAI) {
      return res.status(400).json({
        error: 'PROVIDER_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        providerId: 'openai',
        message: 'Connect your OpenAI API key before starting this task.'
      });
    }
  } else if (selection.providerId === 'ollama') {
    const endpoint = OllamaProvider.normalizeBaseUrl(runtimeConfig.providers?.['ollama']?.endpoint);
    const probe = await OllamaProvider.probe(endpoint, 2000);
    if (probe.status !== 'CONNECTED') {
      return res.status(400).json({
        error: 'PROVIDER_NOT_REACHABLE',
        code: 'PROVIDER_NOT_REACHABLE',
        providerId: 'ollama',
        message: probe.message || `Ollama is not reachable at ${endpoint}.`
      });
    }
  } else if (selection.providerId === 'unknown' && !runtimeConfig.providers?.[modelId]?.apiKey) {
    return res.status(400).json({
      error: 'PROVIDER_NOT_CONFIGURED',
      code: 'PROVIDER_NOT_CONFIGURED',
      providerId: modelId,
      message: `Provider '${modelId}' requires an API key before starting this task.`
    });
  }

  // Workspace Guard: the request's workspace is authoritative. Never fall back to process.cwd().
  const workspace = resolveWorkspaceRoot(taskReq.workspace);
  if (!workspace.ok) {
    return res.status(400).json({
      error: workspace.code,
      code: workspace.code,
      message: workspace.message
    });
  }
  const workspaceRoot = workspace.rootPath;
  const workspaceId = workspace.workspaceId;

  // Mode Guard: honour the composer's choice; only AUTO (or absent) is classified by the kernel.
  let mode: TaskMode = 'AUTO';
  if (taskReq.mode !== undefined && taskReq.mode !== null) {
    const requested = String(taskReq.mode).toUpperCase();
    if (!(TASK_MODES as readonly string[]).includes(requested)) {
      return res.status(400).json({
        error: 'INVALID_MODE',
        code: 'INVALID_MODE',
        message: `mode must be one of ${TASK_MODES.join(', ')} (received '${taskReq.mode}').`
      });
    }
    mode = requested as TaskMode;
  }

  // Autonomy Guard: readonly | ask | auto, defaulting to ask.
  let autonomy: TaskAutonomy = 'ask';
  if (taskReq.autonomy !== undefined && taskReq.autonomy !== null) {
    const requested = String(taskReq.autonomy).toLowerCase();
    if (!(TASK_AUTONOMY_LEVELS as readonly string[]).includes(requested)) {
      return res.status(400).json({
        error: 'INVALID_AUTONOMY',
        code: 'INVALID_AUTONOMY',
        message: `autonomy must be one of ${TASK_AUTONOMY_LEVELS.join(', ')} (received '${taskReq.autonomy}').`
      });
    }
    autonomy = requested as TaskAutonomy;
  }

  // Budget Guard: the shipped defaults unless the caller asks for something else, within ceilings.
  const limitsResolution = resolveTaskLimits(taskReq.limits);
  if (!limitsResolution.ok) {
    return res.status(400).json({
      error: 'INVALID_LIMITS',
      code: 'INVALID_LIMITS',
      message: limitsResolution.message
    });
  }
  const taskLimits = limitsResolution.limits;

  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const controller = new AbortController();
  taskControllers.set(taskId, controller);

  // The resolved budget is reported back, so a caller that measures a run knows what it ran under.
  res.status(201).json({ taskId, workspaceRoot, limits: taskLimits });

  const emit = (event: AgentEvent) => {
    eventStore.append(event);
    const streams = eventStreams.get(taskId) || [];
    streams.forEach(stream => {
      stream.write(`id: ${event.eventId}\n`);
      stream.write(`event: ${event.type}\n`);
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  };

  const closeStreams = () => {
    finishedTasks.add(taskId);
    const streams = eventStreams.get(taskId) || [];
    streams.forEach(stream => stream.end());
    eventStreams.delete(taskId);
  };

  const scheduleCleanup = () => {
    setTimeout(() => {
      eventStore.clear(taskId);
      taskChangeSets.delete(taskId);
      taskControllers.delete(taskId);
      finishedTasks.delete(taskId);
    }, 5 * 60 * 1000);
  };

  /**
   * Guarantees the task ends with a terminal event, whatever happened.
   *
   * The orchestrator publishes one on most paths, but not all: a run that stops at a step, tool
   * call or repair limit returns `limit_reached` having emitted only `agent.limit_reached`, and a
   * run that throws early may emit nothing. Either way the stream used to just close, so every
   * client waiting for a terminal event waited forever and the panel stayed on "running".
   *
   * This publishes nothing when the orchestrator already did. It changes no agent behaviour, costs
   * no tokens and alters no outcome; it only tells the client the task is over.
   */
  const ensureTerminalEvent = (taskId: string, failure: { code: string; message: string }) => {
    const history = eventStore.getEvents(taskId);
    const hasTerminal = history.some(
      ev => ev.type === 'task.completed' || ev.type === 'task.failed' || ev.type === 'task.cancelled'
    );
    if (hasTerminal) return;

    emit({
      type: 'task.failed',
      eventId: `evt-${Date.now()}-${failure.code.toLowerCase()}`,
      taskId,
      timestamp: new Date().toISOString(),
      error: failure.message,
      payload: { code: failure.code, message: failure.message }
    } as AgentEvent);
  };

  const userPrompt = taskReq.description || taskReq.prompt || "";
  const turnStartedAt = new Date().toISOString();

  // The thread's boundary, first in the task's stream: a new turn, and what the user said to open it.
  emit({ type: 'turn.started', eventId: `evt-${Date.now()}-turn`, taskId, timestamp: turnStartedAt, turnId: `turn-${taskId}`, prompt: userPrompt });

  /*
   * The turn, recorded in the workspace's session after the task has ended, however it ended.
   *
   * A task that failed or was cancelled is still something COMU did, and "why did that fail" is the
   * next thing the user types. Recording never fails the task: a session that cannot be written is
   * logged, and the task's own outcome stands.
   */
  const recordTurn = (result?: FinishedTask["result"]) => {
    try {
      const turn = turnFromTask({
        taskId,
        workspaceRoot,
        userMessage: userPrompt,
        startedAt: turnStartedAt,
        events: eventStore.getEvents(taskId),
        result,
        diffEngine
      });
      appendTurn(workspaceRoot, turn, { baseDir: options.sessionStoreDir, secrets: heldSecrets() });
    } catch (e: any) {
      console.error(`[Task ${taskId}] the turn could not be recorded in the session: ${e?.message || e}`);
    }
  };

  // Run asynchronously. runTask handles every failure internally, so the timer callback stays void.
  const runTask = async () => {
    try {
      const model = providerFactory(selection, runtimeConfig.providers);

      const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine, {
        planner: new TaskPlanner(),
        verificationEngine: new VerificationEngine(),
        repairEngine: new RepairEngine(),
        interactionManager,
        memoryEngine,
        subagentManager
      });

      const ctx: OrchestratorContext = {
        taskId,
        workspaceRoot,
        workspaceId,
        mode,
        autonomy,
        // A human can only approve what they can see: an attached event stream is the signal.
        hasHumanObserver: () => (eventStreams.get(taskId)?.length ?? 0) > 0,
        // The orchestrator builds the task's instructions from its contract and the tools it is
        // offered (agent-core system_prompt.ts). This is only for anything a host wants to add.
        systemPrompt: "",
        userPrompt,
        // The session this turn continues. Undefined on a workspace's first turn, which is then built
        // exactly as a single task always was.
        session: sessionContextFor(workspaceRoot),
        // Written to the session before the write it precedes. A checkpoint that cannot be written
        // is logged and the change goes ahead: it is data for a later restore, not a gate.
        checkpoint: entry => {
          try {
            recordCheckpoint(workspaceRoot, taskId, { ...entry, path: relativePath(workspaceRoot, entry.path) }, { baseDir: options.sessionStoreDir });
          } catch (e: any) {
            console.error(`[Task ${taskId}] checkpoint for ${entry.path} not recorded: ${e?.message || e}`);
          }
        },
        limits: {
          ...taskLimits,
          approvalTimeoutMs,
          approvalObserverGraceMs: options.approvalObserverGraceMs
        },
        onEvent: (event: AgentEvent) => {
          console.log(`[Event ${event.type}]`, event);
          emit(event);
        },
        abortSignal: controller.signal
      };

      const result = await orchestrator.run(ctx);
      console.log(`[Task ${taskId}] finished with status: ${result.status}`);

      // Store changeset for diff retrieval
      if (result.changeSet) {
        taskChangeSets.set(taskId, result.changeSet);
      }

      // Every task ends with exactly one terminal event, whichever way it ended.
      ensureTerminalEvent(taskId, {
        code: result.status === 'limit_reached' ? 'LIMIT_REACHED' : 'RUN_ENDED_WITHOUT_TERMINAL_EVENT',
        message:
          result.status === 'limit_reached'
            ? `The task stopped early: ${result.error || 'an execution limit was reached'}.`
            : `The task ended with status '${result.status}' and published no terminal event.`
      });

      recordTurn(result);
      closeStreams();
      scheduleCleanup();
    } catch (e: any) {
      console.error(`Error executing task ${taskId}:`, e);
      ensureTerminalEvent(taskId, { code: 'RUNTIME_ERROR', message: e?.message || String(e) });
      recordTurn();
      closeStreams();
      scheduleCleanup();
    }
  };
  setTimeout(() => { void runTask(); }, 0);
}));

app.post('/v1/tasks/:id/cancel', (req, res) => {
  const taskId = req.params.id;
  const controller = taskControllers.get(taskId);
  if (controller) {
    controller.abort();
    interactionManager.cancelTaskInteractions(taskId);

    const cancelEvt = {
      type: "task.cancelled",
      eventId: `evt-${Date.now()}`,
      taskId,
      timestamp: new Date().toISOString()
    };
    eventStore.append(cancelEvt as any);
    const streams = eventStreams.get(taskId) || [];
    streams.forEach(stream => {
      stream.write(`id: ${cancelEvt.eventId}\n`);
      stream.write(`event: ${cancelEvt.type}\n`);
      stream.write(`data: ${JSON.stringify(cancelEvt)}\n\n`);
    });

    res.status(200).json({ status: "cancelled" });
  } else {
    res.status(404).json({ error: "Task not found or already completed" });
  }
});

app.get('/v1/tasks/:id/events', (req, res) => {
  const taskId = req.params.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // 1. Register subscriber FIRST
  const streams = eventStreams.get(taskId) || [];
  streams.push(res);
  eventStreams.set(taskId, streams);

  // 2. Snapshot historical events and replay
  const history = eventStore.getEvents(taskId);
  for (const event of history) {
    res.write(`id: ${event.eventId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // 2b. A task that already finished will never publish again: end the stream after the replay.
  if (finishedTasks.has(taskId)) {
    eventStreams.set(taskId, (eventStreams.get(taskId) || []).filter(s => s !== res));
    res.end();
    return;
  }

  // 3. Clean up on disconnect
  req.on('close', () => {
    const activeStreams = eventStreams.get(taskId) || [];
    eventStreams.set(taskId, activeStreams.filter(s => s !== res));
  });
});

app.get('/v1/tasks/:id/diff', (req, res) => {
  const taskId = req.params.id;
  const path = req.query.path as string;

  const changeSet = taskChangeSets.get(taskId);
  if (!changeSet) {
    return res.status(404).json({ error: 'ChangeSet not found for task' });
  }

  const change = changeSet.changes.get(path);
  if (!change) {
    return res.status(404).json({ error: 'No changes found for path' });
  }

  res.json({
    originalContent: change.originalContent,
    newContent: change.newContent
  });
});

// Human Interaction Endpoints
app.get('/v1/tasks/:id/interactions', (req, res) => {
  const taskId = req.params.id;
  const pending = interactionManager.getPendingInteraction(taskId);
  if (pending) {
    res.json({ interaction: pending });
  } else {
    res.json({ interaction: null });
  }
});

app.post('/v1/tasks/:taskId/interactions/:interactionId/respond', (req, res) => {
  const { taskId, interactionId } = req.params;
  const { response } = req.body;

  if (!response || !response.type) {
    return res.status(400).json({ error: "Missing response or response.type" });
  }

  const pending = interactionManager.getPendingInteraction(taskId);
  if (!pending || pending.interactionId !== interactionId) {
    return res.status(404).json({ error: "Interaction not found, expired, or already resolved" });
  }

  if (pending.type === "INPUT" && response.type !== "INPUT") {
    return res.status(400).json({ error: "Invalid response type for INPUT interaction" });
  }

  if (pending.type === "APPROVAL" && response.type !== "APPROVE" && response.type !== "APPROVE_SESSION" && response.type !== "DENY") {
    return res.status(400).json({ error: "Invalid response type for APPROVAL interaction" });
  }
  if (response.type === "APPROVE_SESSION") {
    const scopeKey = typeof response.scopeKey === "string" ? response.scopeKey : "";
    const offered = (pending.approval?.scopes || []).map(s => s.key);
    if (!scopeKey || !offered.includes(scopeKey)) {
      return res.status(400).json({ error: "APPROVE_SESSION requires a scopeKey offered by the interaction", offered });
    }
  }

  const success = interactionManager.resolveInteraction(taskId, interactionId, response, (event) => {
    eventStore.append(event);
    const streams = eventStreams.get(taskId) || [];
    streams.forEach(stream => {
      stream.write(`id: ${event.eventId}\n`);
      stream.write(`event: ${event.type}\n`);
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  });

  if (success) {
    res.status(200).json({ status: "resolved" });
  } else {
    res.status(400).json({ error: "Failed to resolve interaction" });
  }
});

// ==========================================
// Milestone 7: Memory API Endpoints
// ==========================================

app.get('/v1/workspace/memory', asyncRoute(async (req, res) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId query parameter is required." });
    }
    const text = (req.query.query as string) || (req.query.text as string);
    const type = req.query.type as any;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await memoryEngine.query({
      workspaceId,
      text,
      types: type ? [type] : undefined,
      limit: Math.min(limit, 50)
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

app.post('/v1/workspace/memory', asyncRoute(async (req, res) => {
  try {
    const { workspaceId, type, content, source, trustLevel, confidence, scope, evidence } = req.body;

    if (!workspaceId || !type || !content) {
      return res.status(400).json({ error: "Missing required fields: workspaceId, type, and content are required." });
    }

    if (!["CONVENTION", "LESSON", "EPISODE"].includes(type)) {
      return res.status(400).json({ error: `Invalid memory type: ${type}. Must be CONVENTION, LESSON, or EPISODE.` });
    }

    const assignedSource = source === "USER" || !source ? "USER" : source;
    const assignedTrust = assignedSource === "USER" ? "USER_VERIFIED" : (trustLevel || "AGENT_DERIVED");

    const entry = await memoryEngine.record({
      workspaceId,
      type,
      content,
      source: assignedSource,
      trustLevel: assignedTrust,
      confidence: confidence || 1.0,
      status: "ACTIVE",
      scope: scope || { workspaceId },
      evidence
    });

    res.status(201).json({ entry });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

app.delete('/v1/workspace/memory/:id', asyncRoute(async (req, res) => {
  try {
    const memoryId = req.params.id;
    const workspaceId = (req.query.workspaceId as string) || (req.body?.workspaceId as string);
    const reason = (req.query.reason as string) || (req.body?.reason as string) || "Manual deletion / invalidation";

    if (!workspaceId) {
      return res.status(400).json({ error: "workspaceId is required to invalidate memory." });
    }

    await memoryEngine.invalidate(workspaceId, memoryId, reason);
    res.json({ status: "invalidated", memoryId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

// ==========================================
// Milestone 7: Subagent Inspection Endpoint
// ==========================================

app.get('/v1/tasks/:taskId/subagents', (req, res) => {
  const { taskId } = req.params;
  const events = eventStore.getEvents(taskId);
  const subagentEvents = events.filter(e => e.type.startsWith("subagent."));

  res.json({
    taskId,
    subagents: subagentEvents
  });
});

app.use(jsonErrorHandler);

return app;
}

function resolveStartupToken(): string | undefined {
  const fromEnv = process.env.COMU_RUNTIME_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (require.main === module) {
    // Standalone start without a token: never run open. Generate one and print it for the operator.
    const generated = generateRuntimeToken();
    console.log(`[COMU] COMU_RUNTIME_TOKEN not set; generated session token: ${generated}`);
    return generated;
  }
  // Embedded/test usage constructs its own app via createRuntimeApp({ authToken }).
  return undefined;
}

const app: Express = createRuntimeApp({ authToken: resolveStartupToken() });

if (require.main === module) {
  const port = process.env.PORT || 3456;
  startRuntimeServer(app, port)
    .then(() => console.log(`Agent runtime server listening on http://${LOOPBACK_HOST}:${port} (loopback only, token required)`))
    .catch(err => {
      console.error(`[COMU] Failed to bind runtime on ${LOOPBACK_HOST}:${port}: ${err?.message || err}`);
      process.exit(1);
    });
}

export default app;
