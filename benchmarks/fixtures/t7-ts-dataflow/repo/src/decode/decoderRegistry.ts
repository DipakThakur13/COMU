import { CsvDecoder } from "./csvDecoder.ts";
import { JsonlDecoder } from "./jsonlDecoder.ts";

export type RawRecord = Record<string, unknown>;

export interface Decoder {
  readonly format: string;
  decode(bytes: string): RawRecord[];
}

const csv = new CsvDecoder();
const jsonl = new JsonlDecoder();

/**
 * Chooses a decoder by sniffing the content, not by looking at the file name.
 *
 * The first non-whitespace byte decides: `{` or `[` means JSON lines, anything else means CSV.
 * The `name` argument is accepted and used only for the log line; the extension is deliberately
 * ignored, because two vendors ship JSON inside files called `.csv` and one ships CSV inside
 * files called `.json`. A consequence nobody expects: renaming a file cannot change how it is
 * parsed, and a CSV whose header row begins with a stray brace is decoded as JSON and fails.
 */
export function decoderFor(bytes: string, _name?: string): Decoder {
  const first = bytes.trimStart().charAt(0);
  return first === "{" || first === "[" ? jsonl : csv;
}

export function decoderByFormat(format: string): Decoder {
  return format === "jsonl" ? jsonl : csv;
}
