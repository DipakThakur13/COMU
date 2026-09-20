import type { Decoder, RawRecord } from "./decoderRegistry.ts";

/**
 * A small, unforgiving CSV reader. Quoted fields are supported; embedded newlines are not.
 */
export class CsvDecoder implements Decoder {
  readonly format = "csv";

  decode(bytes: string): RawRecord[] {
    const lines = bytes.split(/\r?\n/).filter(line => line.trim() !== "");
    const header = lines.shift();
    if (!header) return [];

    const columns = splitRow(header);
    return lines.map(line => {
      const cells = splitRow(line);
      const record: RawRecord = {};
      columns.forEach((column, index) => {
        record[column] = cells[index] ?? "";
      });
      return record;
    });
  }
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch ?? "";
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}
