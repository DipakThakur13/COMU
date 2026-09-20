import type { RouteHandler } from "../http/router.ts";

/**
 * The route table, such as it is.
 *
 * There is no literal list of routes anywhere in this repository. Each module under
 * `http/routes` calls `registerRoute` at import time, and the router only ever reads what
 * happens to be in here. A route that nobody imports does not exist.
 */
interface Registration {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const registrations: Registration[] = [];

/** `/consignments/:id` becomes a pattern plus the key list `["id"]`. */
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map(segment => {
      if (!segment.startsWith(":")) return segment;
      keys.push(segment.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { pattern: new RegExp("^" + source + "$"), keys };
}

export function registerRoute(method: string, path: string, handler: RouteHandler): void {
  const { pattern, keys } = compile(path);
  registrations.push({ method: method.toUpperCase(), pattern, keys, handler });
}

export interface Match {
  handler: RouteHandler;
  params: Record<string, string>;
}

export function lookupRoute(method: string, path: string): Match | undefined {
  for (const entry of registrations) {
    if (entry.method !== method.toUpperCase()) continue;
    const matched = entry.pattern.exec(path);
    if (!matched) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, index) => {
      params[key] = matched[index + 1] ?? "";
    });
    return { handler: entry.handler, params };
  }
  return undefined;
}

export function registeredCount(): number {
  return registrations.length;
}
