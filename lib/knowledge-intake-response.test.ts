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
      keywords: ["AI工具", "真实问题", "务实表达"],
      confidence: "高",
      confidenceReason: "核心观点和表达态度均可从原文直接确认。",
      ingestRecommend: "建议入库",
      ingestReason: "能够帮助后续AI理解该IP的判断方式和表达风格。",
    },
  }));

  assert.equal(result.item.title, "喂鱼对AI工具的真实态度");
  assert.equal(result.item.category, "IP历史内容");
  assert.equal(result.item.keyPoints.length, 3);
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
