"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = require("path");
const tool_core_1 = require("@comu/tool-core");
const tool_filesystem_1 = require("@comu/tool-filesystem");
const tool_search_1 = require("@comu/tool-search");
const terminal_1 = require("@comu/terminal");
const git_1 = require("@comu/git");
const validation_1 = require("@comu/validation");
const agent_core_1 = require("@comu/agent-core");
const diff_engine_1 = require("@comu/diff-engine");
const provider_nvidia_1 = require("@comu/provider-nvidia");
const event_store_js_1 = require("./event_store.js");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
const port = process.env.PORT || 3456;
// Setup tools
const registry = new tool_core_1.ToolRegistry();
registry.register(tool_filesystem_1.ReadFileTool);
registry.register(tool_filesystem_1.ListDirectoryTool);
registry.register(tool_filesystem_1.GetWorkspaceTreeTool);
registry.register(tool_filesystem_1.CreateFileTool);
registry.register(tool_filesystem_1.WriteFileTool);
registry.register(tool_filesystem_1.EditFileTool);
registry.register(new terminal_1.TerminalTool());
registry.register(new git_1.GitStatusTool());
registry.register(new git_1.GitDiffTool());
registry.register(new validation_1.RunTestsTool());
registry.register(new validation_1.RunBuildTool());
registry.register(new validation_1.RunLinterTool());
registry.register(new validation_1.RunTypecheckTool());
// Register search tool with backend
const searchBackend = new tool_search_1.NodeRecursiveSearchBackend();
registry.register({
    ...tool_search_1.SearchTextTool,
    execute: async (args, ctx) => tool_search_1.SearchTextTool.execute(args, { ...ctx, searchBackend })
});
const executor = new tool_core_1.ToolExecutor(registry);
const diffEngine = new diff_engine_1.ComuDiffEngine();
// Global config state
let runtimeConfig = {
    providers: {}
};
// Global SSE connection tracking and event store
const eventStreams = new Map();
const eventStore = new event_store_js_1.InMemoryTaskEventStore({ maxEventsPerTask: 5000 });
const taskChangeSets = new Map();
const taskControllers = new Map();
app.post('/v1/config/providers', (req, res) => {
    const { providers } = req.body;
    if (providers) {
        runtimeConfig.providers = providers;
        res.status(200).json({ status: "ok" });
    }
    else {
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
    const workspaceRoot = (0, path_1.resolve)(process.cwd());
    res.status(201).json({ taskId });
    // Run asynchronously
    setTimeout(async () => {
        try {
            // Setup provider dynamically
            const nvidiaKey = runtimeConfig.providers?.['nvidia']?.apiKey || process.env.NVIDIA_API_KEY || "dummy-key";
            const model = new provider_nvidia_1.NvidiaProvider(nvidiaKey);
            const orchestrator = new agent_core_1.AgentOrchestrator(model, registry, executor, diffEngine);
            const controller = new AbortController();
            taskControllers.set(taskId, controller);
            const ctx = {
                taskId,
                workspaceRoot,
                systemPrompt: "You are an AI coding assistant. Follow instructions precisely.",
                userPrompt: taskReq.description || taskReq.prompt || "",
                limits: {
                    maxSteps: 30,
                    maxToolCalls: 100,
                    maxExecutionTimeMs: 5 * 60 * 1000 // 5 mins
                },
                onEvent: (event) => {
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
        }
        catch (e) {
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
    }
    else {
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
    const path = req.query.path;
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
exports.default = app;
//# sourceMappingURL=server.js.map