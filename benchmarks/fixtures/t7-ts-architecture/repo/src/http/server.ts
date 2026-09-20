import type { Config } from "../boot/config.ts";
import type { Container } from "../boot/container.ts";
import { withBody } from "./middleware/body.ts";
import { withTrace } from "./middleware/trace.ts";
import { route } from "./router.ts";
import type { Request, Response } from "./router.ts";

export interface Server {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
}

/**
 * A transport shim. The pipeline is fixed: trace, then body, then the router.
 *
 * Note that no validation happens on this path. The middleware chain is deliberately short;
 * everything that could reject a payload lives further in.
 */
export function createServer(app: Container, config: Config): Server {
  const pipeline = withTrace(withBody(route));

  return {
    async listen(port: number) {
      app.logger.info("bind", { port, region: config.region });
    },
    async close() {
      app.logger.info("unbind", {});
    },
    handle(request: Request) {
      return pipeline(request);
    }
  };
}
