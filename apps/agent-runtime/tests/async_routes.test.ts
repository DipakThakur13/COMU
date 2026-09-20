import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Server } from "http";
import { asyncRoute, jsonErrorHandler } from "../src/server";

describe("Express async route handling", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.get("/ok", asyncRoute(async (_req, res) => {
      await new Promise(r => setTimeout(r, 5));
      res.json({ ok: true });
    }));
    app.get("/boom", asyncRoute(async () => {
      await new Promise(r => setTimeout(r, 5));
      throw new Error("handler exploded");
    }));
    app.get("/late", asyncRoute(async (_req, res) => {
      res.status(200).write("partial");
      throw new Error("after headers");
    }));
    app.use(jsonErrorHandler);
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it("passes successful async handlers through unchanged", async () => {
    const res = await fetch(`${baseUrl}/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("turns a rejected async handler into a JSON 500 instead of a hung request", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/boom`, { signal: controller.signal });
    clearTimeout(timer);
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("handler exploded");
  });

  it("ends the response if headers were already sent when the handler failed", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/late`, { signal: controller.signal });
    clearTimeout(timer);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("partial");
  });
});
