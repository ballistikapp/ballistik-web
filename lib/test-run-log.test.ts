import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendTestRunLogEvent,
  getTestRunLoggingState,
} from "./test-run-log";

test("writes jsonl events with run metadata and safe serialization", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "test-run-log-"));
  const logPath = path.join(tempDir, "nested", "run.jsonl");

  try {
    await appendTestRunLogEvent(
      {
        eventType: "dashboard_summary",
        source: "dashboard-client",
        tokenPublicKey: "token-123",
        snapshot: {
          tokenAmount: BigInt(42),
          recordedAt: new Date("2026-03-20T10:00:00.000Z"),
          error: new Error("snapshot failed"),
        },
      },
      {
        enabled: true,
        runId: "run-abc",
        logPath,
        timestamp: new Date("2026-03-20T10:15:00.000Z"),
      }
    );

    const contents = await readFile(logPath, "utf8");
    const lines = contents.trim().split("\n");
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0] ?? "{}");
    assert.equal(parsed.runId, "run-abc");
    assert.equal(parsed.eventType, "dashboard_summary");
    assert.equal(parsed.timestamp, "2026-03-20T10:15:00.000Z");
    assert.equal(parsed.snapshot.tokenAmount, "42");
    assert.equal(parsed.snapshot.recordedAt, "2026-03-20T10:00:00.000Z");
    assert.equal(parsed.snapshot.error.errorMessage, "snapshot failed");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("derives enabled logging state from environment", () => {
  const state = getTestRunLoggingState({
    env: {
      NODE_ENV: "test",
      TEST_RUN_LOG_ENABLED: "true",
      TEST_RUN_ID: "prod-check",
      TEST_RUN_LOG_PATH: "/tmp/prod-check.jsonl",
    } as NodeJS.ProcessEnv,
    cwd: "/workspace/app",
  });

  assert.deepEqual(state, {
    enabled: true,
    runId: "prod-check",
    logPath: "/tmp/prod-check.jsonl",
  });
});

test("defaults to visible logs directory when no explicit path is set", () => {
  const state = getTestRunLoggingState({
    env: {
      NODE_ENV: "test",
      TEST_RUN_LOG_ENABLED: "true",
      TEST_RUN_ID: "visible-run",
    } as NodeJS.ProcessEnv,
    cwd: "/workspace/app",
  });

  assert.deepEqual(state, {
    enabled: true,
    runId: "visible-run",
    logPath: "/workspace/app/logs/test-runs/visible-run.jsonl",
  });
});

test("handles circular payloads without throwing", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "test-run-log-circular-"));
  const logPath = path.join(tempDir, "run.jsonl");
  const circular: Record<string, unknown> = {
    label: "root",
  };
  circular.self = circular;

  try {
    const result = await appendTestRunLogEvent(
      {
        eventType: "dashboard_full_snapshot",
        snapshot: circular,
      },
      {
        enabled: true,
        runId: "run-circular",
        logPath,
      }
    );

    assert.equal(result.written, true);
    const contents = await readFile(logPath, "utf8");
    const parsed = JSON.parse(contents.trim());
    assert.equal(parsed.snapshot.self, "[Circular]");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
