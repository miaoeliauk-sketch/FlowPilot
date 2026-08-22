import assert from "node:assert/strict";
import { after, test } from "node:test";
import { getKnowledgeEntriesForFullLibraryComparison } from "./ip-store";
import { runKnowledgeIntakePrecheck } from "./knowledge-intake-precheck";
import type { KnowledgeEntry } from "./types";

class CountingStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    this.values.set(key, value);
  }

  seed(key: string, value: string) {
    this.values.set(key, value);
    this.writes = 0;
  }
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new CountingStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

after(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

test("全库比较入口只读返回全局知识和不同IP知识", () => {
  storage.seed("ipwr:knowledgeEntries", JSON.stringify([
    {
      id: "global-method",
      category: "方法论",
      title: "全局方法",
      createdAt: "2026-08-20T00:00:00.000Z",
      ipId: null,
    },
    {
      id: "ip-a-source",
      category: "IP原始内容",
      title: "IP A逐字稿",
      createdAt: "2026-08-21T00:00:00.000Z",
      ipId: "ip-a",
    },
    {
      id: "ip-b-method",
      category: "选题方法库",
      title: "IP B方法",
      createdAt: "2026-08-22T00:00:00.000Z",
      ipId: "ip-b",
    },
  ]));

  const entries = getKnowledgeEntriesForFullLibraryComparison();

  assert.deepEqual(entries.map(entry => entry.id), ["ip-b-method", "ip-a-source", "global-method"]);
  assert.equal(storage.writes, 0);
});

function existingEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "existing-1",
    category: "选题方法库",
    title: "反常识选题法",
    rawContent: [
      "【一句话总结】\n用反常识冲突解决普通选题缺少吸引力的问题",
      "【核心方法】\n先指出大众默认判断，再用真实反例推翻它",
      "【适用场景】\n知识口播\n观点短视频",
      "【AI调用方式】\n当选题缺少冲突时，用反例重构切入角度",
    ].join("\n\n"),
    sourceKind: null,
    sourceName: "课程第一讲",
    sourceAnalysis: null,
    tags: ["反常识"],
    keywords: ["选题"],
    ipId: "ip-shuimuran",
    sourceTier: "中",
    sourceTierReason: "历史资料",
    contentDirection: ["知识口播", "观点短视频"],
    sourcePlatform: "直播逐字稿",
    sourceUrl: "https://example.com/source",
    note: "{旧格式损坏",
    createdAt: "2026-07-01T00:00:00.000Z",
    extractedAt: null,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用",
    dna: null,
    ...overrides,
  };
}

test("全库检查兼容旧知识正文并生成可读来源说明", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "candidate-1",
      kind: "method_card",
      title: "反常识选题法",
      summary: "用反常识冲突解决普通选题缺少吸引力的问题",
      coreMethod: "先指出大众默认判断，再用真实反例推翻它",
      applicableScenarios: ["知识口播", "观点短视频"],
      aiUsage: "当选题缺少冲突时，用反例重构切入角度",
      rawContent: "完整的待入库方法卡内容，用于验证质量检查不会干扰相似结果。",
    }],
    existingEntries: [existingEntry()],
    ipNamesById: { "ip-shuimuran": "水木然" },
  });

  assert.deepEqual(result.assessments[0]?.similarEntries, [{
    knowledgeId: "existing-1",
    tier: "exact",
    reasons: ["标题、内容摘要、核心方法、适用场景和使用方式完全一致"],
    title: "反常识选题法",
    category: "选题方法库",
    ownershipLabel: "水木然IP",
    sourceDescription: "直播逐字稿｜课程第一讲",
    sourceUrl: "https://example.com/source",
    createdAt: "2026-07-01T00:00:00.000Z",
  }]);
});

test("空内容只提示需要人工检查而不生成自动拒绝结论", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "empty",
      kind: "raw_text",
      title: "",
      summary: "",
      rawContent: "   ",
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality, {
    status: "needs_manual_review",
    issues: [{ code: "EMPTY_CONTENT", message: "内容为空，请人工检查原始资料是否完整" }],
  });
});

test("有效文字过少时提示人工检查", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "short",
      kind: "raw_text",
      title: "短内容",
      summary: "只有一句",
      rawContent: "只有一句",
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality.issues, [{
    code: "TOO_SHORT",
    message: "有效文字过少，请人工确认是否包含可用信息",
  }]);
});

test("内容几乎全是符号时给出明确质量提示", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "symbols",
      kind: "raw_text",
      title: "符号内容",
      summary: "符号过多",
      rawContent: "！！！@@@###内容？？？……——===+++***",
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality.issues, [{
    code: "MOSTLY_SYMBOLS",
    message: "内容几乎全是符号，请人工检查文本提取是否正常",
  }]);
});

test("相同内容大量重复时提示人工检查", () => {
  const repeatedLine = "先提出问题，再分析原因，最后给出答案。";
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "repeated",
      kind: "raw_text",
      title: "重复逐字稿",
      summary: repeatedLine,
      rawContent: Array.from({ length: 6 }, () => repeatedLine).join("\n"),
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality.issues, [{
    code: "EXCESSIVE_REPETITION",
    message: "内容存在大量重复，请人工检查是否为转录或复制异常",
  }]);
});

test("方法卡关键部分缺失时列出缺失项并提示人工检查", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "missing-parts",
      kind: "method_card",
      title: "选题方法",
      summary: "这是一段长度足够的内容摘要，用来说明待入库知识的大致用途和适用问题。",
      coreMethod: "",
      applicableScenarios: [],
      aiUsage: "",
      rawContent: "这是一段长度足够的知识内容，但尚未填写核心方法、适用场景和具体使用方式。",
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality.issues, [{
    code: "MISSING_CRITICAL_PARTS",
    message: "关键部分缺失：核心方法、适用场景、使用方式，请人工检查",
  }]);
});

test("内容存在明显截断迹象时提示人工检查", () => {
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "truncated",
      kind: "raw_text",
      title: "未完逐字稿",
      summary: "内容在关键位置结束",
      rawContent: "前面已经解释了问题产生的背景和两个主要原因，接下来最重要的解决方法是…",
    }],
    existingEntries: [],
  });

  assert.deepEqual(result.assessments[0]?.quality.issues, [{
    code: "POSSIBLY_TRUNCATED",
    message: "内容存在明显截断迹象，请人工检查原文是否完整",
  }]);
});

test("原始逐字稿按原文跨全库比较且使用原文相似原因", () => {
  const transcript = "今天讲一个反常识选题方法。先写出大家默认相信的判断，再用真实案例推翻这个判断，形成新的选题角度。";
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "transcript",
      kind: "raw_text",
      title: "待入库直播逐字稿",
      summary: "反常识选题方法",
      rawContent: transcript,
    }],
    existingEntries: [existingEntry({
      id: "existing-transcript",
      category: "IP原始内容",
      title: "历史直播原文",
      rawContent: transcript,
      ipId: "ip-other",
      sourcePlatform: "直播逐字稿",
      sourceName: "7月直播",
      note: "",
    })],
    ipNamesById: { "ip-other": "另一个IP" },
  });

  assert.deepEqual(result.assessments[0]?.similarEntries.map(entry => ({
    knowledgeId: entry.knowledgeId,
    tier: entry.tier,
    reasons: entry.reasons,
    ownershipLabel: entry.ownershipLabel,
  })), [{
    knowledgeId: "existing-transcript",
    tier: "exact",
    reasons: ["原文内容完全一致"],
    ownershipLabel: "另一个IP",
  }]);
});

test("旧知识缺少结构字段时只按正文比较并如实说明依据", () => {
  const legacyBody = "先找出目标用户普遍相信的判断，再用一个可以核对的真实反例推翻它，从而形成反常识选题。";
  const result = runKnowledgeIntakePrecheck({
    candidates: [{
      id: "method-card",
      kind: "method_card",
      title: "反常识选题法",
      summary: "用真实反例制造选题冲突",
      coreMethod: "先写默认判断，再用反例推翻",
      applicableScenarios: ["知识口播"],
      aiUsage: "选题缺少冲突时调用",
      rawContent: legacyBody,
    }],
    existingEntries: [existingEntry({
      id: "legacy-unstructured",
      title: "旧版反常识选题记录",
      rawContent: legacyBody,
      note: "",
      contentDirection: [],
      sourcePlatform: "手动录入",
      sourceName: "",
    })],
  });

  assert.deepEqual(result.assessments[0]?.similarEntries.map(entry => ({
    knowledgeId: entry.knowledgeId,
    tier: entry.tier,
    reasons: entry.reasons,
  })), [{
    knowledgeId: "legacy-unstructured",
    tier: "exact",
    reasons: ["正文内容完全一致"],
  }]);
});
