export type LogLevel = "debug" | "info" | "warn" | "error";

function line(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  };
  const text = JSON.stringify(payload);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => line("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => line("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => line("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => line("error", msg, extra),
};
