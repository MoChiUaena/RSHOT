// Log subprocess metadata only: commands, environment values and output may contain secrets.
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export interface CommandFailureDetails {
  code: string | null;
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  timeoutMs: number;
  stdoutBytes: number;
  stderrBytes: number;
}
export class PublicationCommandError extends Error {
  details: CommandFailureDetails;
  constructor(reason: string, details: CommandFailureDetails) {
    super(reason);
    this.name = "PublicationCommandError";
    this.details = details;
  }
}
export function runPublicationCommand(command: string, args: string[], reason: string,
  options: { cwd: string; timeoutMs?: number; maxBuffer?: number }): string {
  const timeoutMs = options.timeoutMs ?? 120000;
  const startedAt = Date.now();
  try {
    return execFileSync(command, args, { cwd: options.cwd, timeout: timeoutMs, maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024,
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COLLECT_ENABLED: "false", MODEL_CALLS_ENABLED: "false" } }).trimEnd();
  } catch (error) {
    const failure = error as { code?: unknown; status?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown };
    const bytes = (value: unknown) => Buffer.isBuffer(value) ? value.length : typeof value === "string" ? Buffer.byteLength(value) : 0;
    const codes = ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ENOBUFS", "EPIPE", "ENOMEM"];
    const signals = ["SIGTERM", "SIGKILL", "SIGABRT", "SIGINT", "SIGSEGV"];
    throw new PublicationCommandError(reason, {
      code: typeof failure.code === "string" ? codes.includes(failure.code) ? failure.code : "other" : null,
      exitCode: typeof failure.status === "number" ? failure.status : null,
      signal: typeof failure.signal === "string" ? signals.includes(failure.signal) ? failure.signal : "other" : null,
      elapsedMs: Date.now() - startedAt, timeoutMs, stdoutBytes: bytes(failure.stdout), stderrBytes: bytes(failure.stderr),
    });
  }
}

// Only the read-only status subprocess is retried; Git mutations are never replayed here.
export async function retryStatus<T>(read: () => T,
  onFailure: (failure: { attempt: number; reason: string; details: CommandFailureDetails | null }) => void,
  retryDelaysMs: readonly number[] = [15000, 30000]): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return read(); }
    catch (error) {
      onFailure({ attempt, reason: error instanceof PublicationCommandError ? error.message : "update-status-invalid",
        details: error instanceof PublicationCommandError ? error.details : null });
      const wait = retryDelaysMs[attempt - 1];
      if (wait === undefined) throw error;
      await delay(wait);
    }
  }
}
