import test from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/retry.ts";
import { ApiClient, HttpError, type HttpResponse } from "../src/client.ts";

// Grader-only. The feature does not exist in the starting tree, so nothing the agent can see
// covers it; these are the whole specification of the new behaviour, edge cases included.

/** A transport that replays a script and records every call. */
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

test("withRetry returns the first successful result without repeating", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  }, { attempts: 3 });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry repeats until the call succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error(`flaky ${calls}`);
    return "ok";
  }, { attempts: 4 });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry gives up after the configured number of attempts", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => {
      calls++;
      throw new Error(`down ${calls}`);
    }, { attempts: 3 }),
    /down 3/
  );
  assert.equal(calls, 3);
});

test("withRetry rejects with the last error", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    }, { attempts: 2 }),
    /failure 2/
  );
});

test("withRetry numbers the attempts from one", async () => {
  const seen: number[] = [];
  await assert.rejects(() => withRetry(async attempt => {
    seen.push(attempt);
    throw new Error("nope");
  }, { attempts: 3 }));
  assert.deepEqual(seen, [1, 2, 3]);
});

test("withRetry stops as soon as shouldRetry says no", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => {
      calls++;
      throw new Error(`fatal ${calls}`);
    }, { attempts: 5, shouldRetry: () => false }),
    /fatal 1/
  );
  assert.equal(calls, 1);
});

test("withRetry hands shouldRetry the error and the attempt number", async () => {
  const seen: Array<[string, number]> = [];
  await assert.rejects(() => withRetry(async attempt => {
    throw new Error(`boom ${attempt}`);
  }, {
    attempts: 3,
    shouldRetry: (error, attempt) => {
      seen.push([(error as Error).message, attempt]);
      return true;
    }
  }));
  assert.deepEqual(seen, [["boom 1", 1], ["boom 2", 2]]);
});

test("withRetry does not consult shouldRetry after the final attempt", async () => {
  let asked = 0;
  await assert.rejects(() => withRetry(async () => {
    throw new Error("nope");
  }, {
    attempts: 2,
    shouldRetry: () => {
      asked++;
      return true;
    }
  }));
  assert.equal(asked, 1);
});

test("withRetry rejects an attempts count below one", async () => {
  let calls = 0;
  const counting = async () => {
    calls++;
    return "ok";
  };
  await assert.rejects(async () => withRetry(counting, { attempts: 0 }), RangeError);
  await assert.rejects(async () => withRetry(counting, { attempts: -2 }), RangeError);
  await assert.rejects(async () => withRetry(counting, { attempts: 1.5 }), RangeError);
  assert.equal(calls, 0);
});

test("the client repeats a request the server failed to serve", async () => {
  const { transport, calls } = scripted([
    { status: 503, body: "" },
    { status: 503, body: "" },
    { status: 200, body: '{"sku":"A-1"}' }
  ]);
  const body = await new ApiClient(transport, { attempts: 3 }).getJson<{ sku: string }>("/items/A-1");
  assert.deepEqual(body, { sku: "A-1" });
  assert.equal(calls.length, 3);
});

test("the client repeats a request the transport could not make", async () => {
  const { transport, calls } = scripted([new Error("socket hang up"), { status: 200, body: "[]" }]);
  assert.deepEqual(await new ApiClient(transport, { attempts: 2 }).getJson("/items"), []);
  assert.equal(calls.length, 2);
});

test("the client does not repeat a request the server refused", async () => {
  const { transport, calls } = scripted([{ status: 404, body: "" }]);
  await assert.rejects(
    () => new ApiClient(transport, { attempts: 4 }).getJson("/items/nope"),
    (error: unknown) => error instanceof HttpError && error.status === 404
  );
  assert.equal(calls.length, 1);
});

test("the client does not repeat a request whose body would not parse", async () => {
  const { transport, calls } = scripted([{ status: 200, body: "not json" }]);
  await assert.rejects(() => new ApiClient(transport, { attempts: 4 }).getJson("/items"), SyntaxError);
  assert.equal(calls.length, 1);
});

test("the client makes a single request when no attempts are configured", async () => {
  const { transport, calls } = scripted([{ status: 500, body: "" }]);
  await assert.rejects(() => new ApiClient(transport).getJson("/items"), HttpError);
  assert.equal(calls.length, 1);
});
