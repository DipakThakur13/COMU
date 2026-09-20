export type Fields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields: Fields): void;
  warn(event: string, fields: Fields): void;
  error(event: string, fields: Fields): void;
  child(fields: Fields): Logger;
}

function emit(level: string, region: string, base: Fields, event: string, fields: Fields): void {
  const line = JSON.stringify({ level, region, event, ...base, ...fields });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export function createLogger(region: string, base: Fields = {}): Logger {
  return {
    info: (event, fields) => emit("info", region, base, event, fields),
    warn: (event, fields) => emit("warn", region, base, event, fields),
    error: (event, fields) => emit("error", region, base, event, fields),
    child: fields => createLogger(region, { ...base, ...fields })
  };
}
