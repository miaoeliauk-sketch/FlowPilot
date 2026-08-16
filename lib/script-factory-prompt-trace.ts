import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_GENERATIONS = 20;
const GENERATION_DIRECTORY_PATTERN = /^\d{17}-[a-zA-Z0-9_-]+$/;
const pruneQueues = new Map<string, Promise<void>>();

export type ScriptFactoryPromptTraceStage =
  | "content-initial"
  | "content-format-retry"
  | "content-rewrite"
  | "content-compression"
  | "shuimuran-review"
  | "argument-review"
  | "storyboard"
  | "execution";

export interface ScriptFactoryPromptTraceMaterials {
  methodKnowledge: unknown[];
  voiceSamples: unknown[];
  sourceReferences: unknown[];
  caseEvidence: unknown | null;
}

export interface CreateScriptFactoryPromptTraceInput {
  enabled?: boolean;
  generationId: string;
  createdAt: string;
  ipId: string;
  ipName: string;
  generationMode: "standard" | "ip";
  topic: string;
  shuimuranProfileEnabled: boolean;
}

export interface RecordScriptFactoryPromptCallInput {
  stage: ScriptFactoryPromptTraceStage;
  attempt: number;
  systemPrompt: string;
  userPrompt: string;
  retryReason: string | null;
  materials: ScriptFactoryPromptTraceMaterials;
}

export interface ScriptFactoryPromptTrace {
  readonly generationId: string;
  recordCall(input: RecordScriptFactoryPromptCallInput): Promise<boolean>;
}

function defaultEnabled(): boolean {
  if (process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS === "1") return true;
  if (process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS === "0") return false;
  return process.env.NODE_ENV === "development";
}

function defaultRootDir(): string {
  return path.join(process.cwd(), ".flowpilot-diagnostics", "script-factory");
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "trace";
}

async function pruneOldGenerations(rootDir: string): Promise<void> {
  const previous = pruneQueues.get(rootDir) ?? Promise.resolve();
  const current = previous.then(async () => {
    const entries = await readdir(rootDir, { withFileTypes: true });
    const generationDirectories = entries
      .filter(entry => entry.isDirectory() && GENERATION_DIRECTORY_PATTERN.test(entry.name))
      .map(entry => entry.name)
      .sort();
    const staleDirectories = generationDirectories.slice(0, -MAX_GENERATIONS);
    await Promise.all(staleDirectories.map(directory =>
      rm(path.join(rootDir, directory), { recursive: true, force: true })
    ));
  });
  pruneQueues.set(rootDir, current.catch(() => undefined));
  await current;
}

export function createScriptFactoryPromptTrace(
  input: CreateScriptFactoryPromptTraceInput,
): ScriptFactoryPromptTrace {
  const enabled = input.enabled ?? defaultEnabled();
  const rootDir = defaultRootDir();
  const generationId = safeSegment(input.generationId);
  const directoryName = `${input.createdAt.replace(/[^0-9]/g, "")}-${generationId}`;
  const generationDir = path.join(rootDir, directoryName);
  let callIndex = 0;
  let writeQueue = Promise.resolve(true);

  return {
    generationId: input.generationId,
    recordCall(call) {
      if (!enabled) return Promise.resolve(false);
      callIndex += 1;
      const currentIndex = callIndex;
      writeQueue = writeQueue.then(async () => {
        try {
          await mkdir(generationDir, { recursive: true, mode: 0o700 });
          const fileName = `${String(currentIndex).padStart(3, "0")}-${safeSegment(call.stage)}.json`;
          const targetPath = path.join(generationDir, fileName);
          const tempPath = `${targetPath}.${safeSegment(input.generationId)}.tmp`;
          const record = {
            generationId: input.generationId,
            callIndex: currentIndex,
            createdAt: input.createdAt,
            ipId: input.ipId,
            ipName: input.ipName,
            generationMode: input.generationMode,
            topic: input.topic,
            shuimuranProfileEnabled: input.shuimuranProfileEnabled,
            stage: call.stage,
            attempt: call.attempt,
            retryReason: call.retryReason,
            systemPrompt: call.systemPrompt,
            userPrompt: call.userPrompt,
            materials: call.materials,
          };
          await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
          });
          await rename(tempPath, targetPath);
          await pruneOldGenerations(rootDir);
          return true;
        } catch {
          return false;
        }
      });
      return writeQueue;
    },
  };
}
