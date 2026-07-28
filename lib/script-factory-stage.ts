import type { ScriptFactoryStage } from "./script-factory-contract";

interface StageAttemptContext {
  attempt: number;
  signal: AbortSignal;
}

interface StageRetryOptions {
  timeoutMs: number;
  maxRetries: number;
}

class StageTimeoutError extends Error {
  constructor(stage: ScriptFactoryStage, timeoutMs: number) {
    super(`${stage}阶段超过${Math.round(timeoutMs / 1000)}秒未完成`);
    this.name = "StageTimeoutError";
  }
}

export class ScriptFactoryStageError extends Error {
  readonly stage: ScriptFactoryStage;
  readonly attempts: number;
  readonly timedOut: boolean;
  readonly cause: unknown;

  constructor(
    stage: ScriptFactoryStage,
    attempts: number,
    cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : `${stage}阶段生成失败`;
    super(message);
    this.name = "ScriptFactoryStageError";
    this.stage = stage;
    this.attempts = attempts;
    this.timedOut = cause instanceof StageTimeoutError;
    this.cause = cause;
  }
}

export async function runScriptFactoryStage<T>(
  stage: ScriptFactoryStage,
  task: (context: StageAttemptContext) => Promise<T>,
  options: StageRetryOptions,
): Promise<T> {
  const totalAttempts = options.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new StageTimeoutError(stage, options.timeoutMs);

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, options.timeoutMs);
      });
      const operation = Promise.resolve().then(() =>
        task({ attempt, signal: controller.signal }),
      );
      return await Promise.race([operation, timeout]);
    } catch (error) {
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new ScriptFactoryStageError(stage, totalAttempts, lastError);
}
