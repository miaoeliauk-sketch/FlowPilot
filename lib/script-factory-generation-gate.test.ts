import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as issueGlobalConstraintChallenge } from "../app/api/global-content-constraint/challenge/route";
import { POST as confirmGlobalConstraint } from "../app/api/global-content-constraint/confirm/route";
import { POST } from "../app/api/script-factory/route";
import { POST as auditGeneratedScript } from "../app/api/script-factory/audit/route";
import type { IPProfile } from "./types";
import {
  buildEphemeralCognitionProofClaims,
  createEphemeralCognitionProof,
  verifyEphemeralCognitionProof,
} from "./ip-boundary-interview-proof";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";
import { getIPSourceAnalysisProofSecret } from "./ip-source-analysis-proof";
import { createTeacherOriginalSourceSnapshot } from "./script-factory-source-snapshot-server";

const IP: IPProfile = {
  id: "ip-1", name: "测试IP", avatar: "测", positioning: "商业观察",
  platforms: ["视频号"], audience: "创业者", contentDirection: ["商业"],
  personaKeywords: [], professionalIdentity: "作者", personalityTags: [], credibilitySource: "公开写作",
  representativeViewpoints: [], tone: "克制", commonOpenings: [], commonClosings: [], catchphrases: [],
  forbiddenExpressions: [], pacing: "递进", commonScenes: [], commonShotTypes: [], showsFace: true,
  usesScreenRecording: false, needsBroll: false, needsCaseScreenshots: false, needsSubtitleHighlight: false,
  sampleViralTitles: [], styleNotes: "", bio: "", color: "#000000", createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

const OTHER_IP: IPProfile = { ...IP, id: "ip-2", name: "另一个测试IP" };

const VALID_CONTENT = {
  titles: [{
    title: "真正值得关注的变化",
    formula: "对象＋悬念",
    platform: "视频号",
    whyFitsIP: "承接当前IP的商业观察定位",
  }],
  coverCopy: ["变化已经发生"],
  outline: [
    {
      label: "现象", timeRange: "0—30秒",
      content: "很多人只看见结果发生变化，却没有追问推动结果变化的原因。真正需要观察的不是一时热闹，而是需求、成本和人的选择正在怎样重新组合。",
      subPoints: [],
    },
    {
      label: "判断", timeRange: "30—60秒",
      content: "当这些信号同时出现时，普通人更该调整判断顺序。先看真实需求，再看变化是否持续，最后决定自己的行动，不要把短期情绪当成长期趋势。",
      subPoints: [],
    },
  ],
  commentGuidance: { interactionPrompt: "你最近观察到了什么变化？", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
  ipStyleExplanation: "从具体现象进入判断。",
  pendingVerification: [],
};

function deepSeekResponse(content: unknown, id: string): Response {
  return new Response(JSON.stringify({
    id,
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function requestFor(extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/script-factory", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
    body: JSON.stringify({
      generationMode: "ip", directorRule: null, ipProfile: IP, topic: "变化背后的原因",
      formatCategory: "short", needsStoryboard: false, needsShootingTips: false,
      ...extra,
    }),
  });
}

async function withSuccessfulModel<T>(run: (prompts: string[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    prompts.push((body.messages ?? []).map(message => message.content ?? "").join("\n"));
    if (calls === 1) return deepSeekResponse(JSON.stringify(VALID_CONTENT), "content");
    return deepSeekResponse(JSON.stringify({ issues: [] }), `review-${calls}`);
  };
  try { return await run(prompts); }
  finally { globalThis.fetch = originalFetch; }
}

async function registeredLegacyContext() {
  const sourceId = `source-legacy-gate-${Date.now()}-${Math.random()}`;
  const originalExcerpt = "不要只看结果，要看结果背后的判断方式。";
  const analysis = {
    analyzedAt: "2026-08-25T12:00:00.000Z",
    parserVersion: 1 as const,
    items: [{
      id: "claim-1",
      kind: "claim" as const,
      content: "结果变化之前，判断方式已经变化。",
      sourceId,
      startPosition: 0,
      endPosition: originalExcerpt.length,
      originalExcerpt,
      extractionStatus: "人工确认" as const,
    }],
  };
  const { buildIPSourceLegacyProofClaims } = await import("./ip-source-analysis-proof");
  const { trustLegacyMigrationForTests } = await import("./ip-source-ledger");
  await trustLegacyMigrationForTests(buildIPSourceLegacyProofClaims({
    ipId: IP.id,
    sourceId,
    rawContent: originalExcerpt,
    contextItems: analysis.items,
  }));
  const { POST: registerPOST } = await import("../app/api/ip-source-analysis/legacy/register/route");
  const response = await registerPOST(new NextRequest(
    "http://localhost/api/ip-source-analysis/legacy/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activeIPId: IP.id,
        sourceIPId: IP.id,
        sourceId,
        rawContent: originalExcerpt,
        analysis,
      }),
    },
  ));
  const result = await response.json() as { legacyProof?: string; error?: string };
  assert.equal(response.status, 200, result.error);
  return {
    parserVersion: 1 as const,
    legacyProof: result.legacyProof,
    ipId: IP.id,
    sourceId,
    sourceTitle: "老师直播原文",
    itemId: "claim-1",
    kind: "claim" as const,
    content: "结果变化之前，判断方式已经变化。",
    originalExcerpt,
    extractionStatus: "人工确认" as const,
  };
}

test("IP专属生成没有覆盖度结果也能直接生成正文", async () => {
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.generationMode, "ip");
    assert.equal(body.outline.length, 2);
    assert.equal(prompts.length, 2);
    assert.equal(body.attributionAudit, undefined);
    assert.equal(body.factAudit, undefined);
  });
});

test("IP专属生成只按服务端来源编号读取老师原文而不接收浏览器重传正文", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-generation-source-snapshot-"));
  const previous = process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = path.join(directory, "ledger.json");
  try {
    const source = await createTeacherOriginalSourceSnapshot({
      ipId: IP.id,
      title: "老师关于真实判断的原文",
      rawContent: "老师明确说：真正需要观察的是需求、成本和人的选择如何重新组合。",
      idempotencyKey: "generation-trusted-source-001",
    });
    await withSuccessfulModel(async prompts => {
      const response = await POST(requestFor({
        activeIPId: IP.id,
        teacherOriginalSources: [{
          sourceId: source.sourceId,
          contentSha256: source.contentSha256,
        }],
      }));
      const body = await response.json();

      assert.equal(response.status, 200, body.error);
      assert.ok(prompts[0]?.includes(source.rawContent));
      assert.equal(JSON.stringify(body).includes(source.rawContent), false, "生成响应不应回传老师原文全文");
      assert.equal(typeof body.generationEvidenceProof, "string");
      assert.equal(body.generationEvidenceProof.split(".").length, 4);
      assert.equal(
        body.generationEvidenceProof.split(".").some((part: string) => (
          Buffer.from(part, "base64url").toString("utf8").includes(source.rawContent)
        )),
        false,
        "生成凭证必须保持不透明，不能让浏览器解码出老师原文",
      );
    });
  } finally {
    if (previous === undefined) delete process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("生成端使用25条合法来源时签发的凭证能够通过审计验签", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-generation-25-sources-"));
  const previousAuditLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(directory, "audit-ledger.json");
  try {
  const sourceContext: Awaited<ReturnType<typeof registeredLegacyContext>>[] = [];
  for (let index = 0; index < 25; index += 1) {
    sourceContext.push(await registeredLegacyContext());
  }

  let generated: Record<string, unknown> = {};
  await withSuccessfulModel(async () => {
    const response = await POST(requestFor({ ipSourceContext: sourceContext }));
    generated = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(typeof generated.generationEvidenceProof, "string");
  });

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return deepSeekResponse(JSON.stringify({
        coverage: "PARTIAL",
        reason: "25条已核验来源共同支持生成正文。",
        coveredDimensions: ["核心判断"],
        missingDimensions: ["推理过程"],
        sourceReferences: sourceContext.map(source => ({
          sourceId: source.sourceId,
          itemId: source.itemId,
        })),
        caseNeed: "NOT_ASSESSED",
        caseReason: "推理过程尚未覆盖，暂不判断案例需求。",
      }), "coverage-25-sources");
    }
    return deepSeekResponse(JSON.stringify({
      paragraphs: (generated.outline as Array<unknown>).map((_section, index) => ({
        paragraphId: `S${index + 1}-P1`,
        attributionType: "ai_reasoning",
        reasoningSubtype: "unsupported_opinion",
        sourceReferences: [],
        reason: "该段属于无来源分析性判断。",
      })),
      integrityIssues: [],
    }), "attribution-25-sources");
  };
  try {
    const response = await auditGeneratedScript(new NextRequest(
      "http://localhost/api/script-factory/audit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
        body: JSON.stringify({
          activeIPId: IP.id,
          generationEvidenceProof: generated.generationEvidenceProof,
          content: {
            outline: generated.outline,
            pendingVerification: generated.pendingVerification,
          },
        }),
      },
    ));
    const result = await response.json();

    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(calls, 2, JSON.stringify(result));
    assert.equal(result.status, "completed", JSON.stringify(result));
  } finally {
    globalThis.fetch = originalFetch;
  }
  } finally {
    if (previousAuditLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousAuditLedger;
    await rm(directory, { recursive: true, force: true });
  }
});

test("用来源A生成后不能替换为同一IP的合法来源B送审", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-generation-audit-binding-"));
  const previousSourceLedger = process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
  const previousAuditLedger = process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
  process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = path.join(directory, "source-ledger.json");
  process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = path.join(directory, "audit-ledger.json");
  try {
    const sourceA = await createTeacherOriginalSourceSnapshot({
      ipId: IP.id,
      title: "来源A",
      rawContent: "来源A明确提出：先观察真实需求，再判断变化是否持续。",
      idempotencyKey: "generation-audit-binding-source-a",
    });
    const sourceB = await createTeacherOriginalSourceSnapshot({
      ipId: IP.id,
      title: "来源B",
      rawContent: "来源B讨论的是另一个完全不同的判断。",
      idempotencyKey: "generation-audit-binding-source-b",
    });
    let generated: Record<string, unknown> = {};
    await withSuccessfulModel(async () => {
      const response = await POST(requestFor({
        activeIPId: IP.id,
        teacherOriginalSources: [{
          sourceId: sourceA.sourceId,
          contentSha256: sourceA.contentSha256,
        }],
      }));
      generated = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200);
    });

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return deepSeekResponse(JSON.stringify({
          coverage: "NONE",
          reason: "来源B不支持生成正文。",
          coveredDimensions: [],
          missingDimensions: ["核心判断", "推理过程"],
          sourceReferences: [],
          caseNeed: "NOT_ASSESSED",
          caseReason: "需要先确认可信来源。",
        }), "coverage-swapped-source");
      }
      return deepSeekResponse(JSON.stringify({
        paragraphs: (generated.outline as Array<unknown>).map((_section, index) => ({
          paragraphId: `S${index + 1}-P1`,
          attributionType: "ai_reasoning",
          reasoningSubtype: "unsupported_opinion",
          sourceReferences: [],
          reason: "来源B无法支持该段正文。",
        })),
        integrityIssues: [],
      }), "attribution-swapped-source");
    };
    try {
      const trustedResponse = await auditGeneratedScript(new NextRequest(
        "http://localhost/api/script-factory/audit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
          body: JSON.stringify({
            activeIPId: IP.id,
            generationEvidenceProof: generated.generationEvidenceProof,
            content: {
              outline: generated.outline,
              pendingVerification: generated.pendingVerification,
            },
          }),
        },
      ));
      assert.equal(trustedResponse.status, 200, JSON.stringify(await trustedResponse.json()));

      const changedContentResponse = await auditGeneratedScript(new NextRequest(
        "http://localhost/api/script-factory/audit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
          body: JSON.stringify({
            activeIPId: IP.id,
            generationEvidenceProof: generated.generationEvidenceProof,
            content: {
              outline: [{
                ...(generated.outline as Array<Record<string, unknown>>)[0],
                content: "浏览器替换后的正文。",
              }],
              pendingVerification: generated.pendingVerification,
            },
          }),
        },
      ));
      assert.equal(changedContentResponse.status, 400);
      assert.equal((await changedContentResponse.json()).code, "GENERATION_EVIDENCE_MISMATCH");

      const response = await auditGeneratedScript(new NextRequest(
        "http://localhost/api/script-factory/audit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
          body: JSON.stringify({
            activeIPId: IP.id,
            sources: [],
            teacherOriginalSources: [{
              sourceId: sourceB.sourceId,
              contentSha256: sourceB.contentSha256,
            }],
            nonEvidenceReferences: [],
            content: {
              outline: generated.outline,
              pendingVerification: generated.pendingVerification,
            },
          }),
        },
      ));
      const result = await response.json();

      assert.equal(response.status, 400);
      assert.equal(result.code, "GENERATION_EVIDENCE_MISMATCH");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    if (previousSourceLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_SOURCE_LEDGER_FILE = previousSourceLedger;
    if (previousAuditLedger === undefined) delete process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE;
    else process.env.FLOWPILOT_SCRIPT_AUDIT_LEDGER_FILE = previousAuditLedger;
    await rm(directory, { recursive: true, force: true });
  }
});

test("脚本工厂只使用服务端已确认规则并返回真实拦截结果", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-script-constraint-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  const originalFetch = globalThis.fetch;
  try {
    const challengeResponse = await issueGlobalConstraintChallenge(new NextRequest(
      "http://localhost/api/global-content-constraint/challenge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ proposalId: "emotional-coercion-v2" }),
      },
    ));
    const issued = await challengeResponse.json();
    const confirmationResponse = await confirmGlobalConstraint(new NextRequest(
      "http://localhost/api/global-content-constraint/confirm",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({
          proposalId: "emotional-coercion-v2",
          challengeId: issued.challengeId,
          challenge: issued.challenge,
          idempotencyKey: "test-script-runtime-confirmation",
          confirmedBy: "彭彭",
          acknowledgement: "我已逐字核对并确认启用",
        }),
      },
    ));
    assert.equal(confirmationResponse.status, 200);

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return deepSeekResponse(JSON.stringify({
          ...VALID_CONTENT,
          outline: VALID_CONTENT.outline.map((item, index) => index === 0
            ? { ...item, content: `${item.content}不马上行动，你就会被时代抛弃，永远失去改变命运的机会。普通人现在只能立刻照做。` }
            : item),
        }), "constraint-content");
      }
      return deepSeekResponse(JSON.stringify({ issues: [] }), `constraint-review-${calls}`);
    };

    const response = await POST(requestFor());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.globalConstraintReview.reviewRequired, true);
    assert.equal(body.globalConstraintReview.source, "server_ledger");
    assert.equal(body.globalConstraintReview.matches[0]?.ruleId, "global-constraint-emotional-coercion-v2");

    calls = 0;
    const otherResponse = await POST(requestFor({ ipProfile: OTHER_IP }));
    const otherBody = await otherResponse.json();
    assert.equal(otherResponse.status, 200);
    assert.equal(otherBody.globalConstraintReview.reviewRequired, true);
    assert.equal(otherBody.globalConstraintReview.source, "server_ledger");
    assert.equal(otherBody.globalConstraintReview.matches[0]?.ruleId, "global-constraint-emotional-coercion-v2");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("脚本工厂将同一句口播的分镜和字幕副本合并为一条来源明确的命中", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flowpilot-script-constraint-sources-"));
  const previousLedgerFile = process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
  process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = path.join(directory, "ledger.json");
  const originalFetch = globalThis.fetch;
  try {
    const issued = await (await issueGlobalConstraintChallenge(new NextRequest(
      "http://localhost/api/global-content-constraint/challenge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ proposalId: "emotional-coercion-v2" }),
      },
    ))).json();
    const confirmationResponse = await confirmGlobalConstraint(new NextRequest(
      "http://localhost/api/global-content-constraint/confirm",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({
          proposalId: "emotional-coercion-v2",
          challengeId: issued.challengeId,
          challenge: issued.challenge,
          idempotencyKey: "test-script-constraint-source-grouping",
          confirmedBy: "彭彭",
          acknowledgement: "我已逐字核对并确认启用",
        }),
      },
    ));
    assert.equal(confirmationResponse.status, 200);

    const sentence = `${VALID_CONTENT.outline[0]!.content}我们反对用被时代抛弃这种说法贩卖焦虑。`;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return deepSeekResponse(JSON.stringify({
          ...VALID_CONTENT,
          outline: VALID_CONTENT.outline.map((item, index) => index === 0
            ? { ...item, content: sentence }
            : item),
        }), "constraint-source-content");
      }
      if (calls === 2) return deepSeekResponse(JSON.stringify({ issues: [] }), "constraint-source-review");
      return deepSeekResponse(JSON.stringify({
        storyboard: [{
          time: "0—5秒",
          scene: "人物正面口播",
          voiceover: sentence,
          subtitle: sentence,
          shot: "中景",
          material: "",
          editingTip: "",
        }],
        shootingSuggestions: [],
        shotPrompts: [],
        editingRhythm: {
          subtitleHighlights: [],
          soundEffects: [],
          screenRecordingCuts: [],
          caseInserts: [],
          pauses: [],
        },
      }), "constraint-source-storyboard");
    };

    const response = await POST(requestFor({ needsStoryboard: true }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.globalConstraintReview.matches.length, 1);
    assert.deepEqual(
      body.globalConstraintReview.matches[0]?.sources,
      ["口播正文", "分镜口播", "分镜字幕"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLedgerFile === undefined) delete process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE;
    else process.env.FLOWPILOT_GLOBAL_CONSTRAINT_LEDGER_FILE = previousLedgerFile;
    await rm(directory, { recursive: true, force: true });
  }
});

test("没有IP原始内容也能生成，但提示词禁止冒充老师已确认观点", async () => {
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor({ ipSourceContext: [] }));
    assert.equal(response.status, 200);
    assert.match(prompts[0], /当前没有提供老师原始内容/);
    assert.match(prompts[0], /不得写成老师已经确认或长期坚持的观点/);
    assert.doesNotMatch(prompts[0], /本次已经确认的观点依据/);
  });
});

test("当前IP原始内容只作为生成上下文，不作为生成授权", async () => {
  const context = await registeredLegacyContext();
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor({
      ipSourceContext: [context],
    }));
    assert.equal(response.status, 200);
    assert.match(prompts[0], /IP原始内容上下文/);
    assert.match(prompts[0], /不要只看结果，要看结果背后的判断方式/);
    assert.doesNotMatch(prompts[0], /已经确认的观点依据/);
  });
});

test("V2认知缺少最终凭证时不能进入脚本生成提示词", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return deepSeekResponse("{}", "unexpected");
  };
  try {
    const response = await POST(requestFor({
      ipSourceContext: [{
        parserVersion: 2,
        ipId: IP.id,
        sourceId: "source-v2-unverified",
        sourceTitle: "未经终审的认知",
        itemId: "claim-v2-unverified",
        kind: "claim",
        content: "这条内容还没有最终凭证。",
        originalExcerpt: "这条内容还没有最终凭证。",
        extractionStatus: "人工确认",
      }],
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /最终凭证/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("临时认知凭证的选题归属被篡改时返回403并停止生成", async () => {
  const originalFetch = globalThis.fetch;
  let modelCalled = false;
  globalThis.fetch = async () => {
    modelCalled = true;
    return deepSeekResponse("{}", "unexpected-temporary-scope");
  };
  try {
    const response = await POST(requestFor({
      topicId: "topic-b-tampered",
      temporaryCognition: {
        activeIPId: IP.id,
        topicId: "topic-a-authorized",
        sourceId: "interview-source-temporary-a",
        analysis: {
          parserVersion: 2,
          sourceId: "interview-source-temporary-a",
          sourceHash: "a".repeat(64),
          nonce: 2,
          analyzedAt: "2026-08-26T15:00:00.000Z",
          nodes: [],
          aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
        },
        temporaryProof: "signed-temporary-proof-for-topic-a",
      },
    }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "INVALID_TOKEN_SCOPE");
    assert.equal(modelCalled, false, "选题归属不匹配时不得调用脚本生成模型");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("临时认知作用域一致但签名伪造时仍返回403并停止生成", async () => {
  const originalFetch = globalThis.fetch;
  let modelCalled = false;
  globalThis.fetch = async () => {
    modelCalled = true;
    return deepSeekResponse("{}", "unexpected-forged-temporary-proof");
  };
  try {
    const response = await POST(requestFor({
      topicId: "topic-a-authorized",
      temporaryCognition: {
        activeIPId: IP.id,
        topicId: "topic-a-authorized",
        sourceId: "interview-source-temporary-a",
        analysis: {
          parserVersion: 2,
          sourceId: "interview-source-temporary-a",
          sourceHash: "a".repeat(64),
          nonce: 2,
          analyzedAt: "2026-08-26T15:00:00.000Z",
          nodes: [],
          aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
        },
        temporaryProof: "forged-temporary-proof",
      },
    }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "INVALID_TOKEN_SCOPE");
    assert.equal(modelCalled, false, "签名无效时不得调用脚本生成模型");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("合法临时认知只为绑定选题进入脚本生成上下文", async () => {
  const proofSecret = await getIPSourceAnalysisProofSecret();
  const topicId = "topic-ephemeral-generation";
  const topic = "变化背后的原因";
  const sourceId = "interview-source-ephemeral-generation";
  const claim = "真正的变化来自需求和决策方式的重新组合。";
  const reasoning = "先观察真实需求，再判断变化是否持续。";
  const rawContent = `${claim}\n${reasoning}`;
  const analysis = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-26T15:00:00.000Z",
    createId: (() => {
      let index = 0;
      return () => `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
    })(),
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "变化为什么发生？", derivation: "inferred", anchors: [{ quote: claim }] },
        claim: { content: claim, anchors: [{ quote: claim }] },
        reasoning: {
          status: "complete",
          steps: [{ order: 1, content: reasoning, anchors: [{ quote: reasoning }] }],
        },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  analysis.nodes[0]!.reviewStatus = "human_confirmed";
  const claims = buildEphemeralCognitionProofClaims({
    ipId: IP.id,
    topicId,
    topic,
    sourceId,
    analysis,
    issuedAt: Date.now() - 1_000,
  });
  const temporaryProof = createEphemeralCognitionProof(claims, proofSecret);
  assert.equal(verifyEphemeralCognitionProof({
    token: temporaryProof,
    ipId: IP.id,
    topicId,
    topic,
    sourceId,
    analysis,
    secret: proofSecret,
    now: claims.expiresAt + 1,
  }), false, "临时认知凭证超过30分钟后必须失效");

  await withSuccessfulModel(async prompts => {
      const response = await POST(requestFor({
        topicId,
        topic,
        temporaryCognition: {
          activeIPId: IP.id,
          topicId,
          sourceId,
          rawContent,
          analysis,
          temporaryProof,
          expiresAt: claims.expiresAt,
        },
      }));

      assert.equal(response.status, 200);
      assert.match(prompts[0], /本次访谈临时认知/);
      assert.match(prompts[0], new RegExp(claim));
      assert.match(prompts[0], new RegExp(reasoning));
  });
});

test("其他IP的原始内容不能进入当前IP生成请求", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    const response = await POST(requestFor({
      ipSourceContext: [{
        ipId: "ip-other", sourceId: "source-other", sourceTitle: "其他IP原文", itemId: "claim-other", kind: "claim",
        content: "其他IP的观点。", originalExcerpt: "这段话属于其他IP。", extractionStatus: "人工确认",
      }],
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /不属于当前IP/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("其他IP的参考知识不能进入当前IP生成请求", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    const response = await POST(requestFor({
      knowledgeRefs: [{
        id: "knowledge-other",
        ipId: "ip-other",
        title: "其他IP的方法",
        category: "IP历史内容",
        rawContent: "只属于其他IP的参考资料。",
        reason: "测试越权资料",
      }],
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /参考知识不属于当前IP/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("参考知识缺少归属或归属类型错误时不能绕过当前IP隔离", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    for (const knowledgeRef of [
      { id: "missing-owner", title: "缺少归属", category: "方法", rawContent: "内容", reason: "测试" },
      { id: "invalid-owner", ipId: 123, title: "错误归属", category: "方法", rawContent: "内容", reason: "测试" },
    ]) {
      const response = await POST(requestFor({ knowledgeRefs: [knowledgeRef] }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /参考知识归属无效/);
    }
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("明确标记为通用的参考知识可以参与当前IP生成", async () => {
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor({
      knowledgeRefs: [{
        id: "global-method",
        ipId: null,
        title: "通用表达方法",
        category: "文案框架方法库",
        rawContent: "先呈现矛盾，再解释原因。",
        reason: "与选题结构相关",
      }],
    }));
    assert.equal(response.status, 200);
    assert.match(prompts[0], /通用表达方法/);
  });
});

test("未经核验的案例只能作为待核验素材进入生成", async () => {
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor({
      caseEvidence: {
        title: "网络案例",
        content: "网友认为某个结果由当事人的动机直接造成。",
        sourceType: "用户提供",
        verificationStatus: "未经系统核验",
      },
    }));
    assert.equal(response.status, 200);
    assert.match(prompts[0], /人物、时间、数据和因果不得写成已核实事实/);
    assert.match(prompts[0], /人物动机即使案例已经核实/);
    assert.match(prompts[0], /必须放入待核验内容/);
  });
});

test("即使案例标记为已核实，人物动机仍不能脱离明确原话写成事实", async () => {
  await withSuccessfulModel(async prompts => {
    const response = await POST(requestFor({
      caseEvidence: {
        title: "公开案例",
        content: "事件经过有可靠来源，但没有当事人解释自己的动机。",
        sourceType: "公开报道",
        verificationStatus: "人工已核实",
      },
    }));
    assert.equal(response.status, 200);
    assert.match(prompts[0], /人物动机即使案例已经核实/);
    assert.match(prompts[0], /明确原话依据/);
  });
});

test("案例字段结构错误时在调用模型前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    const response = await POST(requestFor({ caseEvidence: "不是案例对象" }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /案例素材格式错误/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("其他IP的案例素材不能进入当前IP生成请求", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    const response = await POST(requestFor({
      caseEvidence: {
        ipId: "ip-other",
        title: "其他IP案例",
        content: "这条案例只属于其他IP。",
        sourceType: "知识库",
        verificationStatus: "有明确来源",
      },
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /案例素材不属于当前IP/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("未知生成模式会在调用模型前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return deepSeekResponse("{}", "unexpected"); };
  try {
    const response = await POST(requestFor({ generationMode: "unknown" }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /生成模式无效/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});
