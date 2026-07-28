import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { ScriptFactoryStageError, runScriptFactoryStage } from "./script-factory-stage.ts";

test("retries a failed stage once and returns the second result", async () => {
  let attempts = 0;

  const result = await runScriptFactoryStage(
    "content",
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return "complete";
    },
    { timeoutMs: 50, maxRetries: 1 },
  );

  assert.equal(result, "complete");
  assert.equal(attempts, 2);
});

test("aborts a timed out attempt before retrying", async () => {
  let attempts = 0;
  let firstAttemptAborted = false;

  const result = await runScriptFactoryStage(
    "storyboard",
    ({ signal }) => {
      attempts += 1;
      if (attempts === 2) return Promise.resolve("recovered");
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          firstAttemptAborted = true;
          reject(signal.reason);
        });
      });
    },
    { timeoutMs: 10, maxRetries: 1 },
  );

  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
  assert.equal(firstAttemptAborted, true);
});

test("reports the failed stage after all attempts are exhausted", async () => {
  let attempts = 0;

  await assert.rejects(
    runScriptFactoryStage(
      "execution",
      async () => {
        attempts += 1;
        throw new Error("still unavailable");
      },
      { timeoutMs: 50, maxRetries: 1 },
    ),
    (error: unknown) =>
      error instanceof ScriptFactoryStageError &&
      error.stage === "execution" &&
      error.attempts === 2 &&
      error.cause instanceof Error &&
      error.cause.message === "still unavailable",
  );
  assert.equal(attempts, 2);
});
