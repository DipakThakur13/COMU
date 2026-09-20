import { container } from "../../boot/container.ts";
import { registerRoute } from "../../boot/registry.ts";
import type { Request, Response } from "../router.ts";

async function quote(request: Request): Promise<Response> {
  const { pricing } = container();
  const body = (request.body ?? {}) as { weightGrams?: number; zone?: string };
  const priced = pricing.quote({
    weightGrams: body.weightGrams ?? 0,
    zone: body.zone ?? "domestic"
  });
  return { status: 200, headers: {}, body: priced };
}

registerRoute("POST", "/tariffs/quote", quote);
