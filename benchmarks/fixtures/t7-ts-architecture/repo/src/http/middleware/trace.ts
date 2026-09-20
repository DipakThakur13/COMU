import type { RouteHandler } from "../router.ts";

let counter = 0;

/** Stamps a trace id on the way in and echoes it on the way out. */
export function withTrace(next: RouteHandler): RouteHandler {
  return async request => {
    counter += 1;
    const traceId = request.headers["x-trace-id"] ?? "t-" + counter.toString(36).padStart(6, "0");
    const response = await next({ ...request, traceId });
    return { ...response, headers: { ...response.headers, "x-trace-id": traceId } };
  };
}
