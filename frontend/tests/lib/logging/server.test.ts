import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let temporaryRoot: string;

async function loadServerLogger() {
  return import("@/lib/logging/server");
}

async function readFrontendRecords(logDirectory: string) {
  const filenames = await readdir(logDirectory);
  const jsonlFiles = filenames.filter((filename) => filename.startsWith("gamja-frontend-") && filename.endsWith(".jsonl"));

  expect(jsonlFiles).toHaveLength(1);
  const raw = await readFile(join(logDirectory, jsonlFiles[0]), "utf8");
  const records = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

  expect(records.length).toBeGreaterThan(0);
  return { raw, records };
}

describe("server runtime logger", () => {
  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "gamja-frontend-logging-"));
    vi.resetModules();
    vi.stubEnv("APP_LOG_DESTINATION", "file");
    vi.stubEnv("APP_LOG_DIR", join(temporaryRoot, "runtime-logs"));
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("VERCEL", "");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("writes a safe structured error record to an isolated JSONL file", async () => {
    const logger = await loadServerLogger();
    const email = "private-buyer@example.com";
    const password = "do-not-log-this-password";
    const querySecret = "query-secret-value";

    await logger.initializeServerLogger();
    await logger.logServerError(
      new Error(`email=${email}&password=${password}&token=${querySecret}`),
    );

    const { raw, records } = await readFrontendRecords(join(temporaryRoot, "runtime-logs"));
    const errorRecord = records.find((record) => record.event === "server_error");

    expect(errorRecord).toMatchObject({
      level: "ERROR",
      service: "gamja-frontend",
      environment: "development",
      event: "server_error",
      message: "unhandled server error",
    });
    expect(errorRecord?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(errorRecord).toHaveProperty("error_type");
    expect(errorRecord).toHaveProperty("error_code");

    for (const forbidden of [email, password, querySecret, "email", "password", "token"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("forces the stdout sink on Vercel without creating the requested log directory", async () => {
    const logDirectory = join(temporaryRoot, "must-not-exist");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_LOG_DESTINATION", "file");
    vi.stubEnv("APP_LOG_DIR", logDirectory);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = await loadServerLogger();
    await logger.initializeServerLogger();
    await logger.logServerError(new Error("authorization=never-write-this"));

    expect(existsSync(logDirectory)).toBe(false);
    const jsonlOutput = stdout.mock.calls
      .map(([chunk]) => String(chunk))
      .flatMap((chunk) => chunk.split("\n"))
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });

    expect(jsonlOutput).toContainEqual(expect.objectContaining({
      level: "ERROR",
      service: "gamja-frontend",
      event: "server_error",
      message: "unhandled server error",
    }));
    expect(JSON.stringify(jsonlOutput).toLowerCase()).not.toContain("never-write-this");
  });
});
