import type { RouteHandler } from "../router.ts";

/**
 * Parses the request body if it looks like JSON.
 *
 * Parsing is not validation: a body that parses but means nothing passes straight through.
 * Malformed JSON is the only thing this layer rejects.
 */
export function withBody(next: RouteHandler): RouteHandler {
  return async request => {
    if (!request.raw) return next(request);
    try {
      return await next({ ...request, body: JSON.parse(request.raw) });
    } catch {
      return { status: 400, headers: {}, body: { error: "malformed_json" } };
    }
  };
}
