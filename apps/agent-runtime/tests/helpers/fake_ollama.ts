import http from "node:http";

export interface FakeOllamaRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface FakeOllama {
  baseUrl: string;
  requests: FakeOllamaRequest[];
  close(): Promise<void>;
}

/**
 * Minimal in-process stand-in for a local Ollama daemon on the loopback interface.
 * Implements the two endpoints COMU uses: native `/api/tags` and OpenAI-compatible
 * `/v1/chat/completions` (streaming SSE, as the provider requests by default).
 */
export async function startFakeOllama(options?: {
  models?: string[];
  reply?: (body: any) => string;
}): Promise<FakeOllama> {
  const models = options?.models ?? ["llama3.1:8b"];
  const reply = options?.reply ?? (() => "This repository contains a small fixture project.");
  const requests: FakeOllamaRequest[] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      let body: any = undefined;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      requests.push({ method: req.method || "", url: req.url || "", headers: req.headers, body });

      if (req.method === "GET" && req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: models.map(name => ({ name, model: name, size: 1024, details: { family: "llama", parameter_size: "8B" } }))
        }));
        return;
      }

      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const text = reply(body);
        if (body?.stream === false) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "chatcmpl-fake",
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
          }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        const words = text.split(" ");
        for (let i = 0; i < words.length; i++) {
          const piece = (i === 0 ? "" : " ") + words[i];
          res.write(`data: ${JSON.stringify({ id: "chatcmpl-fake", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `unknown route ${req.method} ${req.url}` }));
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as any).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}
