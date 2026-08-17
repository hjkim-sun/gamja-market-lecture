import "server-only";

import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SERVICE = "gamja-frontend";
const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROTATIONS = 4;
const SENSITIVE_KEY = /password|hash|secret|token|authorization|cookie|key|database_url|email/i;
const LOG_FILENAME = /^gamja-frontend-\d{4}-\d{2}-\d{2}-\d+\.jsonl(?:\.[1-4])?$/;

type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";
type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };
type LogRecord = {
  timestamp: string;
  level: LogLevel;
  service: typeof SERVICE;
  environment: string;
  event: string;
  message: string;
  error_type?: "Error" | "UnknownError";
  error_code?: "UNHANDLED_SERVER_ERROR";
  route?: string;
};

type LogSink =
  | { kind: "stdout" }
  | { kind: "file"; directory: string; filename: string };

let sink: LogSink | undefined;
let initialization: Promise<LogSink> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let reportedSinkFailure = false;

function environment() {
  return process.env.APP_ENV || process.env.NODE_ENV || "development";
}

function utcDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isVercel() {
  return process.env.VERCEL === "1";
}

function configuredDestination() {
  if (process.env.APP_LOG_DESTINATION === "file" || process.env.APP_LOG_DESTINATION === "stdout") {
    return process.env.APP_LOG_DESTINATION;
  }

  return process.env.NODE_ENV === "production" ? "stdout" : "file";
}

function resolvedLogDirectory() {
  const configuredDirectory = process.env.APP_LOG_DIR === undefined
    ? "logs"
    : process.env.APP_LOG_DIR;
  if (!configuredDirectory.trim()) return undefined;

  const workingDirectory = resolve(/* turbopackIgnore: true */ process.cwd());
  const directory = isAbsolute(configuredDirectory)
    ? resolve(/* turbopackIgnore: true */ configuredDirectory)
    : resolve(/* turbopackIgnore: true */ workingDirectory, configuredDirectory);

  if (!isAbsolute(configuredDirectory)) {
    const pathFromWorkingDirectory = relative(workingDirectory, directory);
    if (pathFromWorkingDirectory === ".." || pathFromWorkingDirectory.startsWith(`..${sep}`)) {
      return undefined;
    }
  }

  return directory;
}

function filenameForToday() {
  return `${SERVICE}-${utcDate()}-${process.pid}.jsonl`;
}

function writeToStdout(record: LogRecord) {
  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Logging must never affect application behaviour.
  }
}

function reportSinkFailure() {
  if (reportedSinkFailure) return;
  reportedSinkFailure = true;
  writeToStdout({
    timestamp: new Date().toISOString(),
    level: "WARNING",
    service: SERVICE,
    environment: environment(),
    event: "log_sink_unavailable",
    message: "file log sink unavailable; using stdout",
  });
}

async function pruneExpiredFiles(directory: string) {
  const expirationTime = Date.now() - RETENTION_MS;
  const filenames = await readdir(directory);

  await Promise.all(filenames.filter((filename) => LOG_FILENAME.test(filename)).map(async (filename) => {
    const path = join(directory, filename);
    const details = await stat(path);
    if (details.mtimeMs < expirationTime) await unlink(path);
  }));
}

async function selectSink(): Promise<LogSink> {
  // Serverless filesystems are ephemeral. Do not even create the requested directory on Vercel.
  if (isVercel() || configuredDestination() !== "file") return { kind: "stdout" };

  const directory = resolvedLogDirectory();
  if (!directory) {
    reportSinkFailure();
    return { kind: "stdout" };
  }

  try {
    await mkdir(directory, { recursive: true });
    if (!(await stat(/* turbopackIgnore: true */ directory)).isDirectory()) {
      throw new Error("log directory is not a directory");
    }
    await pruneExpiredFiles(directory);
    return { kind: "file", directory, filename: filenameForToday() };
  } catch {
    reportSinkFailure();
    return { kind: "stdout" };
  }
}

async function rotateIfNeeded(directory: string, filename: string, bytesToWrite: number) {
  const filePath = join(directory, filename);

  try {
    if ((await stat(filePath)).size + bytesToWrite <= MAX_LOG_FILE_BYTES) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  await unlink(`${filePath}.${MAX_ROTATIONS}`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  for (let rotation = MAX_ROTATIONS - 1; rotation >= 1; rotation -= 1) {
    await rename(`${filePath}.${rotation}`, `${filePath}.${rotation + 1}`).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await rename(filePath, `${filePath}.1`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function writeRecord(record: LogRecord) {
  const selectedSink = await initializeServerLogger();
  if (selectedSink.kind === "stdout") {
    writeToStdout(record);
    return;
  }

  const line = `${JSON.stringify(record)}\n`;
  try {
    await rotateIfNeeded(selectedSink.directory, selectedSink.filename, Buffer.byteLength(line));
    await appendFile(
      join(/* turbopackIgnore: true */ selectedSink.directory, selectedSink.filename),
      line,
      "utf8",
    );
  } catch {
    sink = { kind: "stdout" };
    reportSinkFailure();
    writeToStdout(record);
  }
}

function safePathname(pathname: string | undefined) {
  if (!pathname) return undefined;
  const pathWithoutQuery = pathname.split(/[?#]/, 1)[0];
  if (!pathWithoutQuery || !pathWithoutQuery.startsWith("/")) return undefined;
  return pathWithoutQuery;
}

function errorType(error: unknown): "Error" | "UnknownError" {
  return error instanceof Error ? "Error" : "UnknownError";
}

/**
 * Initializes the configured sink. This is intentionally safe to call more than once.
 */
export async function initializeServerLogger() {
  if (sink) return sink;
  if (!initialization) {
    initialization = selectSink().then((selectedSink) => {
      sink = selectedSink;
      return selectedSink;
    });
  }
  return initialization;
}

/**
 * Logs an unexpected server failure without serializing the original error or request data.
 */
export function logServerError(error: unknown, options: { pathname?: string } = {}) {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level: "ERROR",
    service: SERVICE,
    environment: environment(),
    event: "server_error",
    message: "unhandled server error",
    error_type: errorType(error),
    error_code: "UNHANDLED_SERVER_ERROR",
  };
  const route = safePathname(options.pathname);
  if (route) record.route = route;

  writeQueue = writeQueue.catch(() => undefined).then(() => writeRecord(record));
  return writeQueue;
}

/**
 * Redacts values before future server-side structured events are added to this module.
 */
export function redactLogValue(value: unknown): JsonValue {
  if (typeof value === "string") {
    if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(value)) return "[REDACTED]";
    try {
      const parsed = new URL(value);
      return parsed.pathname;
    } catch {
      return value;
    }
  }
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (typeof value === "object") {
    const redacted: { [key: string]: JsonValue } = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactLogValue(nestedValue);
    }
    return redacted;
  }
  return String(value);
}
