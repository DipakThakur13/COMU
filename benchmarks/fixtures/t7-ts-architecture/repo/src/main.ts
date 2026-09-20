import { loadConfig } from "./boot/config.ts";
import { buildContainer } from "./boot/container.ts";
import { createServer } from "./http/server.ts";
import { startDrain } from "./queue/drain.ts";

/**
 * Process entry point.
 *
 * Nothing here knows what a consignment is. It loads configuration, asks the container for a
 * wired application, opens the socket and starts the background drain.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = buildContainer(config);

  const stopDrain = startDrain(app.outbox, app.dispatch, app.clock, config.drainIntervalMs, app.logger);
  const server = createServer(app, config);

  const shutdown = async () => {
    stopDrain();
    await server.close();
    app.logger.info("stopped", {});
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await server.listen(config.port);
  app.logger.info("listening", { port: config.port, region: config.region });
}

void main();
