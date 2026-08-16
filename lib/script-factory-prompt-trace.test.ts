import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScriptFactoryPromptTrace } from "./script-factory-prompt-trace";

test("本机诊断记录保存实际Prompt和素材，但不接受或保存API密钥", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-trace-test-"));
  const originalCwd = process.cwd();
  process.chdir(projectDir);
  const rootDir = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
  try {
    const trace = createScriptFactoryPromptTrace({
      enabled: true,
      generationId: "generation-001",
      createdAt: "2026-08-16T10:00:00.000Z",
      ipId: "ip-shuimuran",
      ipName: "水木然",
      generationMode: "ip",
      topic: "创业失败",
      shuimuranProfileEnabled: true,
    });

    const written = await trace.recordCall({
      stage: "content-initial",
      attempt: 1,
      systemPrompt: "系统提示词：禁止使用通用开头。",
      userPrompt: "用户提示词：请围绕创业失败生成脚本。",
      retryReason: null,
      materials: {
        methodKnowledge: [{ id: "knowledge-1", title: "创业案例", rawContent: "案例原文" }],
        voiceSamples: [{ id: "voice-1", title: "口播样本", rawText: "老师原话" }],
        sourceReferences: [{ sourceId: "source-1", originalExcerpt: "老师关于失败的判断" }],
        caseEvidence: { title: "案例A", content: "案例内容" },
      },
    });
    const resultWritten = await trace.recordResult({
      stage: "content-initial",
      attempt: 1,
      rawResponse: "{\"fullScript\":\"AI实际返回\"}",
      parsedBodyVisibleChars: 6,
      initialBodyVisibleChars: null,
      targetMinimumChars: null,
      targetMaximumChars: null,
      actualCompressionRatio: null,
      exactlyMatchesInitial: null,
      normalizedMatchesInitial: null,
      requestId: "request-001",
      finishReason: "stop",
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        reasoningTokens: 0,
      },
      failureCode: null,
    });

    assert.equal(written, true);
    assert.equal(resultWritten, true);
    const generationDirs = await readdir(rootDir);
    assert.equal(generationDirs.length, 1);
    const files = await readdir(path.join(rootDir, generationDirs[0]!));
    assert.deepEqual(files, ["001-content-initial.json"]);
    assert.equal((await stat(path.join(rootDir, generationDirs[0]!))).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(rootDir, generationDirs[0]!, files[0]!))).mode & 0o777, 0o600);
    const savedText = await readFile(
      path.join(rootDir, generationDirs[0]!, files[0]!),
      "utf8",
    );
    const saved = JSON.parse(savedText) as Record<string, unknown>;

    assert.equal(saved.systemPrompt, "系统提示词：禁止使用通用开头。");
    assert.equal(saved.userPrompt, "用户提示词：请围绕创业失败生成脚本。");
    assert.equal(saved.shuimuranProfileEnabled, true);
    assert.equal(saved.rawResponse, "{\"fullScript\":\"AI实际返回\"}");
    assert.equal(saved.rawResponseChars, 23);
    assert.equal(saved.parsedBodyVisibleChars, 6);
    assert.equal(saved.requestId, "request-001");
    assert.deepEqual(saved.tokenUsage, {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      reasoningTokens: 0,
    });
    assert.deepEqual(
      (saved.materials as { methodKnowledge: unknown[] }).methodKnowledge,
      [{ id: "knowledge-1", title: "创业案例", rawContent: "案例原文" }],
    );
    assert.doesNotMatch(savedText, /test-key|apiKey|authorization/i);
  } finally {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("本机诊断目录只保留最近20次生成", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-trace-retention-"));
  const originalCwd = process.cwd();
  process.chdir(projectDir);
  const rootDir = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
  try {
    for (let index = 0; index < 21; index += 1) {
      const trace = createScriptFactoryPromptTrace({
        enabled: true,
        generationId: `generation-${String(index).padStart(2, "0")}`,
        createdAt: `2026-08-16T10:${String(index).padStart(2, "0")}:00.000Z`,
        ipId: "ip-shuimuran",
        ipName: "水木然",
        generationMode: "ip",
        topic: `选题${index}`,
        shuimuranProfileEnabled: true,
      });
      assert.equal(await trace.recordCall({
        stage: "content-initial",
        attempt: 1,
        systemPrompt: `system-${index}`,
        userPrompt: `user-${index}`,
        retryReason: null,
        materials: {
          methodKnowledge: [],
          voiceSamples: [],
          sourceReferences: [],
          caseEvidence: null,
        },
      }), true);
    }

    const generationDirs = (await readdir(rootDir)).sort();
    assert.equal(generationDirs.length, 20);
    assert.equal(generationDirs.some(name => name.endsWith("generation-00")), false);
    assert.equal(generationDirs.some(name => name.endsWith("generation-20")), true);
  } finally {
    process.chdir(originalCwd);
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("生产环境默认关闭完整Prompt诊断", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-trace-disabled-"));
  const originalCwd = process.cwd();
  process.chdir(projectDir);
  const originalNodeEnvDescriptor = Object.getOwnPropertyDescriptor(process.env, "NODE_ENV");
  const originalEnabled = process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
  try {
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      enumerable: true,
      value: "production",
      writable: true,
    });
    delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
    const trace = createScriptFactoryPromptTrace({
      generationId: "production-generation",
      createdAt: "2026-08-16T12:00:00.000Z",
      ipId: "ip-shuimuran",
      ipName: "水木然",
      generationMode: "ip",
      topic: "生产环境选题",
      shuimuranProfileEnabled: true,
    });

    assert.equal(await trace.recordCall({
      stage: "content-initial",
      attempt: 1,
      systemPrompt: "不应写入",
      userPrompt: "不应写入",
      retryReason: null,
      materials: {
        methodKnowledge: [],
        voiceSamples: [],
        sourceReferences: [],
        caseEvidence: null,
      },
    }), false);
    assert.deepEqual(await readdir(projectDir), []);
  } finally {
    process.chdir(originalCwd);
    if (originalNodeEnvDescriptor) {
      Object.defineProperty(process.env, "NODE_ENV", originalNodeEnvDescriptor);
    } else {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    }
    if (originalEnabled === undefined) delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS;
    else process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS = originalEnabled;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("诊断目录固定在已忽略路径且不接受自定义目录", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "script-factory-trace-fixed-root-"));
  const originalCwd = process.cwd();
  const originalDirectory = process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS_DIR;
  const unsafeDirectory = path.join(projectDir, "unignored-prompts");
  process.chdir(projectDir);
  process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS_DIR = unsafeDirectory;
  try {
    const trace = createScriptFactoryPromptTrace({
      enabled: true,
      generationId: "fixed-directory-generation",
      createdAt: "2026-08-16T13:00:00.000Z",
      ipId: "ip-shuimuran",
      ipName: "水木然",
      generationMode: "ip",
      topic: "固定路径测试",
      shuimuranProfileEnabled: true,
    });
    assert.equal(await trace.recordCall({
      stage: "content-initial",
      attempt: 1,
      systemPrompt: "固定目录系统提示词",
      userPrompt: "固定目录用户提示词",
      retryReason: null,
      materials: {
        methodKnowledge: [],
        voiceSamples: [],
        sourceReferences: [],
        caseEvidence: null,
      },
    }), true);

    const fixedRoot = path.join(projectDir, ".flowpilot-diagnostics", "script-factory");
    assert.equal((await readdir(fixedRoot)).length, 1);
    await assert.rejects(() => readdir(unsafeDirectory), /ENOENT/);
  } finally {
    process.chdir(originalCwd);
    if (originalDirectory === undefined) delete process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS_DIR;
    else process.env.FLOWPILOT_SCRIPT_FACTORY_DIAGNOSTICS_DIR = originalDirectory;
    await rm(projectDir, { recursive: true, force: true });
  }
});
