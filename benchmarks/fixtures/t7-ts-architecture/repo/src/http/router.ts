import { lookupRoute } from "../boot/registry.ts";
import { toResponse } from "../domain/errors.ts";

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  raw: string;
  body?: unknown;
  params?: Record<string, string>;
  traceId?: string;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (request: Request) => Promise<Response>;

/**
 * Dispatch.
 *
 * There is no route table here on purpose; `lookupRoute` answers from whatever the route
 * modules registered when they were imported by the container.
 */
export const route: RouteHandler = async request => {
  const match = lookupRoute(request.method, request.path);
  if (!match) {
    return { status: 404, headers: {}, body: { error: "no_route", path: request.path } };
  }
  try {
    return await match.handler({ ...request, params: match.params });
  } catch (error) {
    return toResponse(error);
  }
};
