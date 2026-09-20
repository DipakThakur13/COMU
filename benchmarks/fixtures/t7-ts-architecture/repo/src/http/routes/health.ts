import { container } from "../../boot/container.ts";
import { registerRoute, registeredCount } from "../../boot/registry.ts";
import type { Response } from "../router.ts";

async function health(): Promise<Response> {
  const { outbox, metrics } = container();
  return {
    status: 200,
    headers: {},
    body: {
      ok: true,
      routes: registeredCount(),
      pending: outbox.pending(),
      dead: outbox.deadCount(),
      counters: metrics.snapshot()
    }
  };
}

registerRoute("GET", "/health", health);
