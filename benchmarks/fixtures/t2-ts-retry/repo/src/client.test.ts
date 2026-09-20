import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, HttpError, type HttpResponse } from "./client.ts";

/** A transport that replays a script and counts how often it was called. */
function scripted(steps: Array<HttpResponse | Error>) {
  const calls: string[] = [];
  const transport = async (path: string): Promise<HttpResponse> => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push(path);
    if (step instanceof Error) throw step;
    return step;
  };
  return { transport, calls };
}

test("getJson parses the body", async () => {
  const { transport } = scripted([{ status: 200, body: '{"sku":"A-1","price":12}' }]);
  const body = await new ApiClient(transport).getJson<{ sku: string; price: number }>("/items/A-1");
  assert.deepEqual(body, { sku: "A-1", price: 12 });
});

test("getJson asks the transport for the path it was given", async () => {
  const { transport, calls } = scripted([{ status: 200, body: "[]" }]);
  await new ApiClient(transport).getJson("/items");
  assert.deepEqual(calls, ["/items"]);
});

test("getJson turns an error status into an HttpError", async () => {
  const { transport } = scripted([{ status: 404, body: "" }]);
  await assert.rejects(() => new ApiClient(transport).getJson("/items/nope"), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 404);
    assert.match(error.message, /GET \/items\/nope failed with 404/);
    return true;
  });
});

test("getJson lets a transport failure through", async () => {
  const { transport } = scripted([new Error("socket hang up")]);
  await assert.rejects(() => new ApiClient(transport).getJson("/items"), /socket hang up/);
});

test("getJson makes exactly one request for a successful call", async () => {
  const { transport, calls } = scripted([{ status: 200, body: "{}" }]);
  await new ApiClient(transport).getJson("/items");
  assert.equal(calls.length, 1);
});
