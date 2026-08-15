import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttributionAudit,
  buildAttributionParagraphs,
  buildFactAudit,
  parseParagraphAttributions,
} from "./script-factory-attribution";

const CONTENT = {
  titles: [{ title: "测试标题", formula: "", platform: "", whyFitsIP: "" }],
  coverCopy: ["封面"],
  outline: [{
    label: "核心判断",
    timeRange: "0-30秒",
    content: "持续输出不是每天更换话题。\n真正需要回答的是同一个长期问题。",
    subPoints: [],
  }],
  commentGuidance: { interactionPrompt: "留言", keywordReplies: [], dmGuidance: "", materialPackGuidance: "" },
  ipStyleExplanation: "测试",
  pendingVerification: [],
};

const REFERENCES = [{
  sourceId: "source-1",
  sourceTitle: "课程原文",
  itemId: "claim-1",
  kind: "claim",
  content: "持续输出不是每天更换话题。",
  originalExcerpt: "持续输出不是每天换一个新话题。",
  extractionStatus: "人工确认",
}] as const;

test("段落审计识别单换行段落并要求每一段返回可追溯来源", () => {
  const paragraphs = buildAttributionParagraphs(CONTENT);
  const result = parseParagraphAttributions(JSON.stringify({
    paragraphs: [{
      paragraphId: "S1-P1",
      attributionType: "teacher_explicit",
      sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
      reason: "与老师原始表达直接对应。",
    }, {
      paragraphId: "S1-P2",
      attributionType: "ai_reasoning",
      sourceReferences: [],
      reason: "原始内容没有这层解释。",
    }],
  }), paragraphs, REFERENCES, false);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    sectionIndex: 0,
    paragraphIndex: 0,
    excerpt: "持续输出不是每天更换话题。",
    attributionType: "teacher_explicit",
    sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
    reason: "与老师原始表达直接对应。",
  });
  assert.equal(result[1]?.attributionType, "ai_reasoning");
});

test("老师表达标记引用不存在的原始内容时拒绝审计结果", () => {
  const paragraphs = buildAttributionParagraphs({
    ...CONTENT,
    outline: [{ ...CONTENT.outline[0], content: "持续输出不是每天更换话题。" }],
  });
  assert.throws(() => parseParagraphAttributions(JSON.stringify({
    paragraphs: [{
      paragraphId: "S1-P1",
      attributionType: "teacher_explicit",
      sourceReferences: [{ sourceId: "fake", itemId: "fake" }],
      reason: "声称来自老师。",
    }],
  }), paragraphs, REFERENCES, false), /引用了不存在的老师原始内容/);
});

test("找不到老师出处的段落只能标记为AI推理补充", () => {
  const paragraphs = buildAttributionParagraphs({
    ...CONTENT,
    outline: [{ ...CONTENT.outline[0], content: "这是AI补充的解释。" }],
  });
  assert.throws(() => parseParagraphAttributions(JSON.stringify({
    paragraphs: [{
      paragraphId: "S1-P1",
      attributionType: "faithful_rewrite",
      sourceReferences: [],
      reason: "没有出处。",
    }],
  }), paragraphs, REFERENCES, false), /老师表达类段落必须提供真实来源/);
});

test("案例事实补充必须真的存在本次案例", () => {
  const paragraphs = buildAttributionParagraphs({
    ...CONTENT,
    outline: [{ ...CONTENT.outline[0], content: "某企业随后调整了经营策略。" }],
  });
  assert.throws(() => parseParagraphAttributions(JSON.stringify({
    paragraphs: [{
      paragraphId: "S1-P1",
      attributionType: "case_fact",
      sourceReferences: [],
      reason: "来自案例。",
    }],
  }), paragraphs, REFERENCES, false), /没有可对应的案例证据/);
});

test("置信度和结果身份由覆盖度与审计结果固定计算", () => {
  const paragraphs = buildAttributionParagraphs(CONTENT);
  const teacherOnly = parseParagraphAttributions(JSON.stringify({
    paragraphs: paragraphs.map(paragraph => ({
      paragraphId: paragraph.id,
      attributionType: "teacher_explicit",
      sourceReferences: [{ sourceId: "source-1", itemId: "claim-1" }],
      reason: "有老师原文依据。",
    })),
  }), paragraphs, REFERENCES, false);
  const withAI = teacherOnly.map((paragraph, index) => index === 1
    ? { ...paragraph, attributionType: "ai_reasoning" as const, sourceReferences: [] }
    : paragraph);

  assert.deepEqual(buildAttributionAudit({
    coverage: "FULL",
    coveredDimensions: ["核心判断", "推理过程"],
    missingDimensions: [],
    paragraphAttributions: teacherOnly,
    auditCompleted: true,
  }), {
    outputStatus: "formal",
    confidenceLevel: "high",
    coveredDimensions: ["核心判断", "推理过程"],
    missingDimensions: [],
    recommendation: "观点和核心推理均有老师原始内容支撑，可以按正式稿审核使用。",
    auditStatus: "completed",
    paragraphAttributions: teacherOnly,
  });
  assert.equal(buildAttributionAudit({
    coverage: "FULL", coveredDimensions: ["核心判断"], missingDimensions: [],
    paragraphAttributions: withAI, auditCompleted: true,
  }).confidenceLevel, "medium");
  assert.equal(buildAttributionAudit({
    coverage: "PARTIAL", coveredDimensions: ["核心判断"], missingDimensions: ["推理过程"],
    paragraphAttributions: teacherOnly, auditCompleted: true,
  }).outputStatus, "review");
  assert.equal(buildAttributionAudit({
    coverage: "NONE", coveredDimensions: [], missingDimensions: ["核心判断"],
    paragraphAttributions: [], auditCompleted: true,
  }).confidenceLevel, "low");
  const unavailable = buildAttributionAudit({
    coverage: "FULL", coveredDimensions: ["核心判断", "推理过程"], missingDimensions: [],
    paragraphAttributions: [], auditCompleted: false,
  });
  assert.equal(unavailable.outputStatus, "review");
  assert.equal(unavailable.confidenceLevel, "low");
});

test("事实核验与观点归属分开记录且系统不会伪装成已核实", () => {
  assert.deepEqual(buildFactAudit({
    pendingItems: ["增长数据待核验"],
    caseEvidence: {
      title: "企业案例",
      sourceType: "用户提供",
      verificationStatus: "人工已核实",
      sourceUrl: "https://example.com",
    },
  }), {
    overallStatus: "pending",
    systemVerified: false,
    pendingItems: ["增长数据待核验"],
    caseEvidence: {
      title: "企业案例",
      sourceType: "用户提供",
      verificationStatus: "人工已核实",
      sourceUrl: "https://example.com",
    },
  });
});

test("案例只声称有明确来源但没有提供来源地址时仍保持待核验", () => {
  const result = buildFactAudit({
    pendingItems: [],
    caseEvidence: {
      title: "企业案例",
      sourceType: "用户提供",
      verificationStatus: "有明确来源",
    },
  });

  assert.equal(result.overallStatus, "pending");
  assert.equal(result.systemVerified, false);
});
