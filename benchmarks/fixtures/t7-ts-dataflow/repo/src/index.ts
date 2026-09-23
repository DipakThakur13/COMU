import { loadSettings } from "./config/settings.ts";
import { profileByName } from "./config/profiles.ts";
import { buildPipeline } from "./pipeline/build.ts";
import { runPipeline } from "./pipeline/runner.ts";
import { createSource } from "./sources/sourceFactory.ts";
import { createLogger } from "./util/logger.ts";
import { SystemClock } from "./util/clock.ts";

/**
 * Entry point. Reads the profile named on the command line, assembles the stages and runs them
 * until the source is exhausted or the process is asked to stop.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const profileName = argv[argv.indexOf("--profile") + 1] ?? "default";
  const profile = profileByName(profileName);
  const settings = loadSettings(process.env, profile);

  const logger = createLogger(profile.name);
  const clock = new SystemClock();

  const source = createSource(settings, logger);
  const pipeline = buildPipeline(settings, clock, logger);

  const stop = () => void source.close();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const summary = await runPipeline(source, pipeline, settings, logger);
  logger.info("finished", { ...summary });
}

void main();
