import assert from "node:assert/strict";
import test from "node:test";
import {
  createKnowledgeEffectReferenceIndex,
  deriveKnowledgeTrustStatus,
} from "./knowledge-effect-reference";
import type {
  KnowledgeEntry,
  KnowledgeUsageRecord,
  ScriptAsset,
  VideoReview,
} from "./types";

function methodCard(usageRecords: KnowledgeUsageRecord[] = []): KnowledgeEntry {
  return {
    id: "method-card-1",
    category: "开头方法库",
    title: "反常识开头法",
    rawContent: "【核心方法】先给出反常识结论。",
    sourceKind: null,
    sourceName: "",
    sourceAnalysis: null,
    tags: [],
    keywords: [],
    ipId: "ip-a",
    sourceTier: "中",
    sourceTierReason: "来自爆款分析",
    contentDirection: [],
    sourcePlatform: "抖音",
    sourceUrl: "",
    note: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords,
    status: usageRecords.length > 0 ? "已用于脚本" : "未使用",
    trustStatus: "ai_derived_unverified",
    sourceReference: {
      sourceType: "hot_analysis",
      analysisId: "analysis-a",
      role: "method_card",
      groupItemId: "method-card-1",
    },
    dna: null,
  };
}

function usage(overrides: Partial<KnowledgeUsageRecord> = {}): KnowledgeUsageRecord {
  return {
    id: "usage-1",
    module: "脚本工厂",
    usedAt: "2026-08-22T01:00:00.000Z",
    reason: "采用了反常识开头",
    relevanceTier: "高度相关",
    relevanceReason: "最终正文包含该方法",
    context: "生成口播脚本",
    trackingStatus: "script_adopted",
    topicId: "topic-1",
    scriptId: "script-1",
    reviewId: null,
    usageType: "structure",
    sectionLabel: "开头",
    evidenceExcerpt: "先给出反常识结论",
    ...overrides,
  };
}

function script(): ScriptAsset {
  return {
    id: "script-1",
    ipId: "ip-a",
    topicId: "topic-1",
    title: "真实采用脚本",
    cover: "",
    content: "先给出反常识结论，再解释原因。",
    status: "定稿",
    knowledgeTracking: {
      status: "verified",
      candidateKnowledgeEntryIds: ["method-card-1"],
      verifiedAt: "2026-08-22T01:00:00.000Z",
      usages: [{
        knowledgeEntryId: "method-card-1",
        usageType: "structure",
        sectionLabel: "开头",
        evidenceExcerpt: "先给出反常识结论",
        reason: "采用了反常识开头",
      }],
    },
    createdAt: "2026-08-22T01:00:00.000Z",
  };
}

function review(): VideoReview {
  return {
    id: "review-1",
    ipId: "ip-a",
    title: "真实发布复盘",
    platform: "抖音",
    publishedAt: "2026-08-23",
    videoUrl: "",
    contentDirection: "知识",
    topicId: "topic-1",
    scriptId: "script-1",
    sourceType: "flowpilot",
    traceabilityStatus: "traceable",
    knowledgeEffectStatus: "tracked",
    scriptText: "先给出反常识结论，再解释原因。",
    metrics: {
      views: 1000,
      likes: 100,
      comments: 10,
      favorites: 20,
      shares: 5,
      newFollowers: 3,
      dms: 1,
      leads: 0,
      conversions: 0,
    },
    analysis: null,
    savedToKnowledge: false,
    knowledgeEntryId: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    manualReviewStatus: "pending",
    manualReviewTags: [],
    manualReviewNote: "",
  };
}

test("AI拆解方法卡只按可信采用和真实复盘证据派生状态1至3", () => {
  const savedScript = script();
  const noEvidenceIndex = createKnowledgeEffectReferenceIndex([], []);
  const adoptedIndex = createKnowledgeEffectReferenceIndex([savedScript], []);
  const reviewedIndex = createKnowledgeEffectReferenceIndex([savedScript], [review()]);

  assert.equal(
    deriveKnowledgeTrustStatus(methodCard(), noEvidenceIndex),
    "ai_derived_unverified",
  );
  assert.equal(
    deriveKnowledgeTrustStatus(methodCard([usage()]), adoptedIndex),
    "adopted_awaiting_effect",
  );
  assert.equal(
    deriveKnowledgeTrustStatus(
      methodCard([usage({ reviewId: "review-1" })]),
      reviewedIndex,
    ),
    "effect_evidence_awaiting_judgment",
  );
  assert.equal(
    deriveKnowledgeTrustStatus(
      methodCard([usage({ trackingStatus: "legacy_unverified", reviewId: "review-1" })]),
      reviewedIndex,
    ),
    "ai_derived_unverified",
  );
});
