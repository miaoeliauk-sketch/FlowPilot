import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 executes this TypeScript test directly.
import { parseIPUnderstandingResponse } from "./knowledge-intake-response.ts";

test("IP content understanding keeps one complete understanding card", () => {
  const result = parseIPUnderstandingResponse(JSON.stringify({
    item: {
      title: "喂鱼对AI工具的真实态度",
      summary: "这段内容表达了喂鱼使用AI时更关注真实问题，而不是追逐工具本身。",
      category: "IP历史内容",
      understanding: "作者强调AI工具必须服务于实际工作，表达中保留了个人经历、判断过程和鲜明态度。",
      keyPoints: ["先确认真实问题", "工具服务于工作", "不为了使用AI而使用AI"],
      relationToIP: "体现了喂鱼务实、直接的内容立场和表达方式。",
      keywords: ["AI工具", "真实问题", "工具路径依赖"],
      confidence: "高",
      confidenceReason: "核心观点和表达态度均可从原文直接确认。",
      ingestRecommend: "建议入库",
      ingestReason: "能够帮助后续AI理解该IP的判断方式和表达风格。",
    },
  }));

  assert.equal(result.item.title, "喂鱼对AI工具的真实态度");
  assert.equal(result.item.category, "IP历史内容");
  assert.equal(result.item.keyPoints.length, 3);
  assert.equal(result.item.keywords.includes("工具路径依赖"), true);
  assert.equal("coreMethod" in result.item, false);
});

test("IP content understanding rejects method-card decomposition", () => {
  assert.throws(
    () => parseIPUnderstandingResponse(JSON.stringify({
      item: {
        title: "AI工具使用方法",
        summary: "把内容拆成一个可以复用的方法。",
        category: "IP历史内容",
        understanding: "作者在讨论AI工具。",
        keyPoints: ["关注真实问题"],
        relationToIP: "来自当前IP的内容。",
        keywords: ["AI工具"],
        confidence: "高",
        confidenceReason: "原文明确表达。",
        ingestRecommend: "建议入库",
        ingestReason: "可以复用。",
        coreMethod: "先找问题，再选择工具",
        triggerKeywords: ["AI"],
        examples: [{ input: "原文", output: "优化结果" }],
      },
    })),
    (error: unknown) =>
      error instanceof Error &&
      "diagnosticCode" in error &&
      error.diagnosticCode === "DECOMPOSITION_NOT_ALLOWED",
  );
});

test("IP content understanding rejects structural labels as keywords", () => {
  assert.throws(
    () => parseIPUnderstandingResponse(JSON.stringify({
      item: {
        title: "水木然内容创作边界",
        summary: "这份资料约束水木然的表达方式和事实边界。",
        category: "IP人设资料",
        understanding: "内容从具体现象进入时代判断，同时用真实性边界保证表达可信。",
        keyPoints: ["不使用第一、第二、第三的固定讲课结构"],
        relationToIP: "用于约束水木然脚本的表达和事实边界。",
        keywords: ["表达路径", "真实性要求", "长期主义"],
        confidence: "高",
        confidenceReason: "原文给出了明确规则。",
        ingestRecommend: "建议入库",
        ingestReason: "避免生成机械讲课式文案。",
      },
    })),
    (error: unknown) =>
      error instanceof Error &&
      "diagnosticCode" in error &&
      error.diagnosticCode === "KEYWORD_TOO_GENERIC",
  );
});

test("IP content understanding checks structural labels before limiting keyword count", () => {
  assert.throws(
    () => parseIPUnderstandingResponse(JSON.stringify({
      item: {
        title: "员工离职风险判断",
        summary: "这份资料记录了识别员工离职风险的判断方式。",
        category: "IP表达语料",
        understanding: "多个行为变化共同构成风险信号。",
        keyPoints: ["严禁在沟通前直接锁定名单"],
        relationToIP: "用于保留当前IP的概率化表达。",
        keywords: [
          "行为熵",
          "概率思维",
          "信息不对称",
          "离职概率模型",
          "灰度预警",
          "社交频率",
          "产出波动",
          "风险信号",
          "表达路径",
        ],
        confidence: "高",
        confidenceReason: "原文明确给出了判断信号。",
        ingestRecommend: "建议入库",
        ingestReason: "避免依赖主观直觉。",
      },
    })),
    (error: unknown) =>
      error instanceof Error &&
      "diagnosticCode" in error &&
      error.diagnosticCode === "KEYWORD_TOO_GENERIC",
  );
});
