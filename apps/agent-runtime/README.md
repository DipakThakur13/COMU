# @comu/agent-runtime

Standalone and embedded Node.js HTTP/SSE server for the COMU AI Software Engineering Agent.

## Overview

`@comu/agent-runtime` acts as the authoritative execution engine for COMU. It orchestrates multi-step engineering tasks, manages active sessions, coordinates tool execution, monitors file mutations, runs automated verification suites, and streams real-time SSE events back to clients (such as the COMU VS Code extension).

## Features

- **Task Lifecycle Management**: Endpoints for task creation (`POST /v1/tasks`), status inspection (`GET /v1/tasks/:id`), cancellation (`POST /v1/tasks/:id/cancel`), and interactive user responses (`POST /v1/tasks/:id/interactions/:interactionId/respond`).
- **Real-Time SSE Streaming**: Server-Sent Events stream (`GET /v1/tasks/:id/events`) delivering granular progress updates, model thoughts, tool calls, and verification results.
- **Provider Configuration**: Dynamic BYOK provider endpoints (`POST /v1/config/providers`) with live connection testing (`POST /v1/config/providers/:providerId/test`).
- **Health Monitoring**: Lightweight health check endpoint (`GET /v1/health`) for non-blocking liveness polling.
- **Embedded & Standalone Support**: Can run embedded inside the VS Code extension process or standalone as a separate microservice on port `3456`.

## Scripts

```bash
# Start development server with auto-reload
pnpm dev

# Build production bundle
pnpm build

# Run runtime test suite
pnpm test
```

## License

MIT © Dipak Kumar (Boswas Group)
