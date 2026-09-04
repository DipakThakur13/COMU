import express, { Express } from 'express';
import cors from 'cors';
import { resolve } from 'path';
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
import { AgentEvent, ProviderConfig, ProviderTestResult } from '@comu/protocol';
import { InMemoryTaskEventStore } from './event_store.js';

const app: Express = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3456;

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
  }
  res.status(404).json({ error: `Provider '${providerId}' not testable` });
});

// Basic health check
app.get("/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post('/v1/tasks', async (req, res) => {
  const taskReq = req.body;
  const modelId = taskReq.modelId || 'nvidia-nemotron-3-ultra';

  // Task-Start Guard: verify provider credential exists before task launch
  const isNvidia = modelId.toLowerCase().includes('nvidia') || modelId.toLowerCase().includes('nemotron');
  const isLocal = modelId.toLowerCase().includes('ollama') || modelId.toLowerCase().includes('local');

  if (isNvidia) {
    const hasNvidia = !!(runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY);
    if (!hasNvidia) {
      return res.status(400).json({
        error: 'PROVIDER_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        providerId: 'nvidia',
        message: 'Connect your NVIDIA API key before starting this task.'
      });
    }
  } else if (!isLocal && !runtimeConfig.providers?.[modelId]?.apiKey) {
    return res.status(400).json({
      error: 'PROVIDER_NOT_CONFIGURED',
      code: 'PROVIDER_NOT_CONFIGURED',
      providerId: modelId,
      message: `Provider '${modelId}' requires an API key before starting this task.`
    });
  }

  const taskId = `task-${Date.now()}`;
  const workspaceRoot = resolve(process.cwd());

  res.status(201).json({ taskId });

  // Run asynchronously
  setTimeout(async () => {
    try {
      // Setup provider dynamically
      const nvidiaKey = runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY || "dummy-key";
      const nvidiaEndpoint = runtimeConfig.providers?.['nvidia']?.endpoint;
      const model = new NvidiaProvider(nvidiaKey, nvidiaEndpoint);
      
      const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine, {
        planner: new TaskPlanner(),
        verificationEngine: new VerificationEngine(),
        repairEngine: new RepairEngine(),
        interactionManager,
        memoryEngine,
        subagentManager
      });

      const controller = new AbortController();
      taskControllers.set(taskId, controller);

      const ctx: OrchestratorContext = {
        taskId,
        workspaceRoot,
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

          // Store event in bounded history
          eventStore.append(event);

          const streams = eventStreams.get(taskId) || [];
          streams.forEach(stream => {
            stream.write(`id: ${event.eventId}\n`);
            stream.write(`event: ${event.type}\n`);
            stream.write(`data: ${JSON.stringify(event)}\n\n`);
          });
        },
        abortSignal: controller.signal
      };

      const result = await orchestrator.run(ctx);
      console.log(`[Task ${taskId}] finished with status: ${result.status}`);

      // Store changeset for diff retrieval
      if (result.changeSet) {
        taskChangeSets.set(taskId, result.changeSet);
      }

      // Close streams
      const streams = eventStreams.get(taskId) || [];
      streams.forEach(stream => stream.end());
      eventStreams.delete(taskId);

      setTimeout(() => {
        eventStore.clear(taskId);
        taskChangeSets.delete(taskId);
        taskControllers.delete(taskId);
      }, 5 * 60 * 1000);
    } catch (e: any) {
      console.error(`Error executing task ${taskId}:`, e);
      // Ensure streams are closed
      const streams = eventStreams.get(taskId) || [];
      streams.forEach(stream => stream.end());
      eventStreams.delete(taskId);

      // Retain failed task events temporarily
      setTimeout(() => {
        eventStore.clear(taskId);
        taskChangeSets.delete(taskId);
        taskControllers.delete(taskId);
      }, 5 * 60 * 1000);
    }
  }, 0);
});

app.post('/v1/tasks/:id/cancel', (req, res) => {
  const taskId = req.params.id;
  const controller = taskControllers.get(taskId);
  if (controller) {
    controller.abort();
    interactionManager.cancelTaskInteractions(taskId);
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
    const workspaceId = (req.query.workspaceId as string) || resolve(process.cwd());
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Agent runtime server listening on port ${port}`);
  });
}

export default app;
