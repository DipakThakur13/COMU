import express, { Express } from 'express';
import cors from 'cors';
import { resolve } from 'path';
import { ToolRegistry, ToolExecutor } from '@comu/tool-core';
import { ReadFileTool, ListDirectoryTool, GetWorkspaceTreeTool, CreateFileTool, WriteFileTool, EditFileTool } from '@comu/tool-filesystem';
import { SearchTextTool, NodeRecursiveSearchBackend } from '@comu/tool-search';
import { TerminalTool } from '@comu/terminal';
import { GitStatusTool, GitDiffTool } from '@comu/git';
import { RunTestsTool, RunBuildTool, RunLinterTool, RunTypecheckTool } from '@comu/validation';
import { AgentOrchestrator, OrchestratorContext } from '@comu/agent-core';
import { ComuDiffEngine } from '@comu/diff-engine';
import { NvidiaProvider } from '@comu/provider-nvidia';
import { AgentEvent } from '@comu/protocol';
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
registry.register(new RunTestsTool());
registry.register(new RunBuildTool());
registry.register(new RunLinterTool());
registry.register(new RunTypecheckTool());

// Register search tool with backend
const searchBackend = new NodeRecursiveSearchBackend();
registry.register({
  ...SearchTextTool,
  execute: async (args, ctx) => SearchTextTool.execute(args, { ...ctx, searchBackend } as any)
});

const executor = new ToolExecutor(registry);
const diffEngine = new ComuDiffEngine();

// Global config state
let runtimeConfig = {
    providers: {} as Record<string, any>
};

// Global SSE connection tracking and event store
const eventStreams = new Map<string, express.Response[]>();
const eventStore = new InMemoryTaskEventStore({ maxEventsPerTask: 5000 });
const taskChangeSets = new Map<string, any>();
const taskControllers = new Map<string, AbortController>();

app.post('/v1/config/providers', (req, res) => {
    const { providers } = req.body;
    if (providers) {
        runtimeConfig.providers = providers;
        res.status(200).json({ status: "ok" });
    } else {
        res.status(400).json({ error: "Missing providers config" });
    }
});

// Basic health check
app.get("/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post('/v1/tasks', async (req, res) => {
  const taskReq = req.body; 
  const taskId = `task-${Date.now()}`;
  const workspaceRoot = resolve(process.cwd()); 

  res.status(201).json({ taskId });

  // Run asynchronously
  setTimeout(async () => {
    try {
      // Setup provider dynamically
      const nvidiaKey = runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY || "dummy-key";
      const model = new NvidiaProvider(nvidiaKey);
      const orchestrator = new AgentOrchestrator(model, registry, executor, diffEngine);
      
      const controller = new AbortController();
      taskControllers.set(taskId, controller);

      const ctx: OrchestratorContext = {
        taskId,
        workspaceRoot,
        systemPrompt: "You are an AI coding assistant. Follow instructions precisely.",
        userPrompt: taskReq.description || taskReq.prompt || "",
        limits: {
          maxSteps: 30,
          maxToolCalls: 100,
          maxExecutionTimeMs: 5 * 60 * 1000 // 5 mins
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Agent runtime server listening on port ${port}`);
  });
}

export default app;
