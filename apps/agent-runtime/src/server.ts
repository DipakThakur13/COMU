import express, { Express } from 'express';
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
import { MemoryEngine, MemoryStorage, MemorySanitizer } from '@comu/memory-engine';
import { NvidiaProvider } from '@comu/provider-nvidia';
import { 
  ModelProvider, 
  OpenAICompatibleProvider, 
  ASTRA_CAPABILITY_PROFILE, 
  DEFAULT_OPENAI_CAPABILITY_PROFILE 
} from '@comu/model-core';
import { AgentEvent, ProviderConfig, ProviderTestResult } from '@comu/protocol';
import { InMemoryTaskEventStore } from './event_store.js';

export type ProviderFactory = (selection: ProviderSelection, config: Record<string, any>) => ModelProvider;

export interface RuntimeServerOptions {
  /** Test seam: replaces provider construction for the task runner. */
  providerFactory?: ProviderFactory;
}

export interface ProviderSelection {
  modelId: string;
  providerId: 'nvidia' | 'experiential' | 'openai' | 'ollama' | 'unknown';
}

export function selectProvider(modelId: string): ProviderSelection {
  const lower = (modelId || '').toLowerCase();
  if (lower.includes('nvidia') || lower.includes('nemotron') || lower.includes('deepseek')) {
    return { modelId, providerId: 'nvidia' };
  }
  if (lower.includes('experiential') || lower.includes('astra')) {
    return { modelId, providerId: 'experiential' };
  }
  if (lower.includes('openai') || lower.includes('gpt-4')) {
    return { modelId, providerId: 'openai' };
  }
  if (lower.includes('ollama') || lower.includes('local')) {
    return { modelId, providerId: 'ollama' };
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

export function defaultProviderFactory(selection: ProviderSelection, providers: Record<string, any>): ModelProvider {
  const { modelId, providerId } = selection;
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
  const nvidiaKey = providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY;
  const nvidiaEndpoint = providers?.['nvidia']?.endpoint;
  return new NvidiaProvider(nvidiaKey, nvidiaEndpoint);
}

export function createRuntimeApp(options: RuntimeServerOptions = {}): Express {
const providerFactory: ProviderFactory = options.providerFactory || defaultProviderFactory;

const app: Express = express();
app.use(express.json());
app.use(cors());

// Setup tools
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

app.post(['/v1/config/providers', '/v1/config'], (req, res) => {
  const providers = req.body.providers || req.body.config;
  if (providers) {
    runtimeConfig.providers = providers;
    res.status(200).json({ status: "ok" });
  } else {
    res.status(400).json({ error: "Missing providers config" });
  }
});

// Safe Provider Configuration List (No API Keys returned)
app.get('/v1/config/providers', (req, res) => {
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
      selectedModel: 'Nemotron 3 Ultra',
      hasCredential: hasNvidiaKey,
      isLocal: false,
      status: hasNvidiaKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      environmentDetected: envNvidia,
      models: [
        { id: 'nvidia-nemotron-3-ultra', name: 'Nemotron 3 Ultra', description: 'NVIDIA Nemotron high-performance engineering model' }
      ],
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
    {
      providerId: 'ollama',
      displayName: 'Ollama (Local)',
      enabled: true,
      selectedModel: 'Llama 3 (Local)',
      hasCredential: true,
      isLocal: true,
      status: 'CONNECTED',
      models: [
        { id: 'ollama-llama-3', name: 'Llama 3 (Local)', description: 'Local offline execution' }
      ],
      description: 'Local on-device inference with zero external network calls'
    }
  ];
  res.status(200).json({ providers });
});

// Safe Single Provider Status (No API Key returned)
app.get('/v1/config/providers/:providerId/status', (req, res) => {
  const { providerId } = req.params;
  if (providerId === 'nvidia') {
    const envNvidia = NvidiaProvider.detectEnvironmentCredential();
    const hasKey = !!(runtimeConfig.providers?.['nvidia']?.apiKey || envNvidia);
    return res.status(200).json({
      providerId: 'nvidia',
      hasCredential: hasKey,
      environmentDetected: envNvidia,
      status: hasKey ? 'CONNECTED' : 'NOT_CONFIGURED',
      selectedModel: 'Nemotron 3 Ultra'
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
    return res.status(200).json({
      providerId: 'ollama',
      hasCredential: true,
      status: 'CONNECTED',
      selectedModel: 'Llama 3 (Local)'
    });
  }
  res.status(404).json({ error: `Provider '${providerId}' not found` });
});

// Test Connection Endpoint
app.post('/v1/config/providers/:providerId/test', async (req, res) => {
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
  }
  res.status(404).json({ error: `Provider '${providerId}' not testable` });
});

// Basic health check
app.get("/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post('/v1/tasks', async (req, res) => {
  const taskReq = req.body || {};
  const modelId: string = taskReq.modelId || 'nvidia-nemotron-3-ultra';
  const selection = selectProvider(modelId);

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

  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const controller = new AbortController();
  taskControllers.set(taskId, controller);

  res.status(201).json({ taskId, workspaceRoot });

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
    const streams = eventStreams.get(taskId) || [];
    streams.forEach(stream => stream.end());
    eventStreams.delete(taskId);
  };

  const scheduleCleanup = () => {
    setTimeout(() => {
      eventStore.clear(taskId);
      taskChangeSets.delete(taskId);
      taskControllers.delete(taskId);
    }, 5 * 60 * 1000);
  };

  // Run asynchronously
  setTimeout(async () => {
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
        systemPrompt: "You are an AI software engineer. Follow instructions precisely.",
        userPrompt: taskReq.description || taskReq.prompt || "",
        limits: {
          maxSteps: 30,
          maxToolCalls: 100,
          maxExecutionTimeMs: 5 * 60 * 1000, // 5 mins
          maxRepairAttempts: 3,
          maxValidationRuns: 6,
          maxRepairFiles: 5,
          maxRepairTimeMs: 180000
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

      closeStreams();
      scheduleCleanup();
    } catch (e: any) {
      console.error(`Error executing task ${taskId}:`, e);
      // The orchestrator normally publishes its own terminal event. If it threw before doing so,
      // publish one here so subscribers never hang waiting for a task that already died.
      const history = eventStore.getEvents(taskId);
      const hasTerminal = history.some(ev => ev.type === 'task.completed' || ev.type === 'task.failed' || ev.type === 'task.cancelled');
      if (!hasTerminal) {
        emit({
          type: 'task.failed',
          eventId: `evt-${Date.now()}-runtime-error`,
          taskId,
          timestamp: new Date().toISOString(),
          error: e?.message || String(e),
          payload: { code: 'RUNTIME_ERROR', message: e?.message || String(e) }
        } as AgentEvent);
      }
      closeStreams();
      scheduleCleanup();
    }
  }, 0);
});

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

  if (pending.type === "APPROVAL" && response.type !== "APPROVE" && response.type !== "DENY") {
    return res.status(400).json({ error: "Invalid response type for APPROVAL interaction" });
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

app.get('/v1/workspace/memory', async (req, res) => {
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
});

app.post('/v1/workspace/memory', async (req, res) => {
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
});

app.delete('/v1/workspace/memory/:id', async (req, res) => {
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
});

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

return app;
}

const app: Express = createRuntimeApp();

if (require.main === module) {
  const port = process.env.PORT || 3456;
  app.listen(port, () => {
    console.log(`Agent runtime server listening on port ${port}`);
  });
}

export default app;
