import { container } from "../../boot/container.ts";
import { registerRoute } from "../../boot/registry.ts";
import type { Request, Response } from "../router.ts";

/**
 * POST /consignments
 *
 * Returns 202, not 201. The handler has not written anything by the time it answers, and has
 * not checked the payload either; it only hands the parsed body to intake.
 */
async function create(request: Request): Promise<Response> {
  const { intake } = container();
  const receipt = await intake.accept(request.body, request.traceId ?? "none");
  return {
    status: 202,
    headers: { location: "/consignments/" + receipt.id },
    body: { id: receipt.id, acceptedAt: receipt.acceptedAt, state: "accepted" }
  };
}

async function read(request: Request): Promise<Response> {
  const { intake } = container();
  const found = await intake.lookup(request.params?.id ?? "");
  if (!found) return { status: 404, headers: {}, body: { error: "unknown_consignment" } };
  return { status: 200, headers: {}, body: found };
}

async function list(request: Request): Promise<Response> {
  const { reads } = container();
  const account = request.params?.account ?? "";
  return { status: 200, headers: {}, body: { items: await reads.byAccount(account) } };
}

registerRoute("POST", "/consignments", create);
registerRoute("GET", "/consignments/:id", read);
registerRoute("GET", "/accounts/:account/consignments", list);
