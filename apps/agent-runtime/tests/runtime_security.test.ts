import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Server } from "http";
import os from "node:os";
import {
  createRuntimeApp,
  startRuntimeServer,
  safeEqual,
  isLoopbackAddress,
  createLoopbackGuard,
  createAuthMiddleware,
  generateRuntimeToken
} from "../src/server";

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}

describe("Runtime network boundary & authentication (Phase 0.2)", () => {
  const token = generateRuntimeToken();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createRuntimeApp({ authToken: token });
    server = await startRuntimeServer(app, 0);
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("generates 64-hex-character tokens and compares them in constant time", () => {
    expect(generateRuntimeToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateRuntimeToken()).not.toBe(generateRuntimeToken());
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(undefined, "abc")).toBe(false);
    expect(safeEqual("abc", undefined)).toBe(false);
  });

  it("binds to the loopback interface only", () => {
    const addr = server.address() as any;
    expect(addr.address).toBe("127.0.0.1");
  });

  it("refuses connections addressed to a non-loopback interface", async () => {
    const lanAddress = Object.values(os.networkInterfaces())
      .flat()
      .find(i => i && i.family === "IPv4" && !i.internal)?.address;
    if (!lanAddress) {
      return; // No non-loopback interface on this machine; nothing to probe.
    }
    const port = (server.address() as any).port;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    await expect(
      fetch(`http://${lanAddress}:${port}/v1/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      })
    ).rejects.toBeTruthy();
    clearTimeout(timer);
  });

  it("loopback guard rejects non-loopback peers even if reached", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);

    const guard = createLoopbackGuard();
    const res = fakeRes();
    let nextCalled = false;
    guard({ socket: { remoteAddress: "192.168.1.20" } } as any, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("NON_LOOPBACK_REJECTED");

    const okRes = fakeRes();
    let okNext = false;
    guard({ socket: { remoteAddress: "::1" } } as any, okRes, () => { okNext = true; });
    expect(okNext).toBe(true);
  });

  it("returns 401 on every route without the token", async () => {
    const routes: Array<[string, string, any?]> = [
      ["GET", "/v1/health"],
      ["GET", "/v1/config/providers"],
      ["POST", "/v1/config/providers", { providers: {} }],
      ["POST", "/v1/tasks", { prompt: "x", modelId: "ollama-local", workspace: { rootPath: os.tmpdir() } }],
      ["GET", "/v1/tasks/nope/events"],
      ["GET", "/v1/tasks/nope/interactions"],
      ["GET", "/v1/workspace/memory?workspaceId=w"]
    ];
    for (const [method, route, body] of routes) {
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      expect(res.status, `${method} ${route}`).toBe(401);
      const data = (await res.json()) as any;
      expect(data.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns 401 for a wrong token", async () => {
    const res = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${"0".repeat(64)}` } });
    expect(res.status).toBe(401);
  });

  it("accepts the token as a bearer header or as X-COMU-Token", async () => {
    const bearer = await fetch(`${baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${token}` } });
    expect(bearer.status).toBe(200);
    const explicit = await fetch(`${baseUrl}/v1/health`, { headers: { "X-COMU-Token": token } });
    expect(explicit.status).toBe(200);
  });

  it("auth middleware never reads credentials from the query string or body", () => {
    const middleware = createAuthMiddleware(token);
    const res = fakeRes();
    let next = false;
    middleware({ headers: {}, query: { token }, body: { token } } as any, res, () => { next = true; });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("scopes CORS to VS Code webview origins", async () => {
    const evil = await fetch(`${baseUrl}/v1/health`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" }
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const webview = await fetch(`${baseUrl}/v1/health`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "vscode-webview://1a2b3c" }
    });
    expect(webview.headers.get("access-control-allow-origin")).toBe("vscode-webview://1a2b3c");
  });
});
