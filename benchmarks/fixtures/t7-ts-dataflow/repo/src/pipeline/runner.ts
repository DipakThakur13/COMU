import type { Settings } from "../config/settings.ts";
import type { Logger } from "../util/logger.ts";
import type { Source } from "../sources/sourceFactory.ts";
import type { Stage } from "./stage.ts";
import { makeContext } from "./stage.ts";
import { decoderFor } from "../decode/decoderRegistry.ts";
import { RingBuffer } from "../buffer/ringBuffer.ts";
import { shouldPause } from "../buffer/backpressure.ts";

export interface Summary {
  read: number;
  dropped: number;
  quarantined: number;
  counters: Record<string, number>;
}

/**
 * Reads chunks from the source, decodes them, parks the records in the ring buffer and pushes
 * them through the stages.
 *
 * The backpressure check is here, and it is advisory only: `shouldPause` is consulted, the answer
 * is written to the log, and the loop carries on regardless. Nothing in this repository ever waits
 * for the buffer to drain.
 */
export async function runPipeline(
  source: Source,
  stages: Stage[],
  settings: Settings,
  logger: Logger
): Promise<Summary> {
  const context = makeContext(settings.profile.name);
  const buffer = new RingBuffer(settings.bufferSlots);
  let read = 0;

  for await (const chunk of source.chunks()) {
    const decoder = decoderFor(chunk.bytes, chunk.name);
    for (const record of decoder.decode(chunk.bytes)) {
      read += 1;
      buffer.push(record);
      if (shouldPause(buffer)) {
        logger.warn("backpressure_advised", { filled: buffer.size(), slots: buffer.capacity() });
      }
    }

    for (const record of buffer.drain()) {
      let carried: Record<string, unknown> | undefined = record;
      for (const stage of stages) {
        if (!carried) break;
        carried = await stage.apply(carried, context);
        if (!carried) context.bump("dropped." + stage.name);
      }
    }

    if (context.quarantine.length > settings.quarantineLimit) {
      throw new Error("quarantine limit exceeded: " + context.quarantine.length);
    }
  }

  return {
    read,
    dropped: buffer.droppedCount(),
    quarantined: context.quarantine.length,
    counters: Object.fromEntries(context.counters)
  };
}
