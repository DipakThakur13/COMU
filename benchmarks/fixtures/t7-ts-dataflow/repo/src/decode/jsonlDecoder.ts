import type { Decoder, RawRecord } from "./decoderRegistry.ts";

/**
 * One JSON object per line, or a single top-level array. Both shapes arrive in practice.
 */
export class JsonlDecoder implements Decoder {
  readonly format = "jsonl";

  decode(bytes: string): RawRecord[] {
    const trimmed = bytes.trim();
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? (parsed as RawRecord[]) : [];
    }

    const out: RawRecord[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      out.push(JSON.parse(line) as RawRecord);
    }
    return out;
  }
}
