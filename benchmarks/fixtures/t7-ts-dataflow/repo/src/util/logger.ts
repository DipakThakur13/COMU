export type Fields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields: Fields): void;
  warn(event: string, fields: Fields): void;
  error(event: string, fields: Fields): void;
}

export function createLogger(profile: string): Logger {
  const emit = (level: string, event: string, fields: Fields) => {
    const line = JSON.stringify({ level, profile, event, ...fields });
    if (level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields)
  };
}
