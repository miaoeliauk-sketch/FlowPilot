import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { getLegacyIPSourceAnalysisItems } from "./ip-source-analysis-v2";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new MemoryStorage();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (previousLocalStorage) Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

test("IP原始内容只保存一份原文，解析结果都回溯到最终Source编号", async () => {
  const { addIPOriginalSource, getIPOriginalSource } = await import("./ip-original-source");
  const originalContent = "第一段：持续输出不是每天换话题。\n\n第二段：它是在围绕一个长期问题持续回答。";

  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "持续输出的真正含义",
    sourceKind: "直播逐字稿",
    originalContent,
    sourceName: "直播整理.txt",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-13T10:00:00.000Z",
      parserVersion: 1,
      items: [{
        id: "A01",
        kind: "claim",
        content: "持续输出不是不断更换话题。",
        sourceId: "draft-source",
        startPosition: 4,
        endPosition: 16,
        originalExcerpt: "持续输出不是每天换话题。",
        extractionStatus: "AI提取",
      }],
    },
  });

  const loaded = getIPOriginalSource(saved.id);
  assert.equal(loaded?.rawContent, originalContent);
  assert.equal(loaded?.category, "IP原始内容");
  assert.equal(loaded?.ipId, "ip-shuimuran");
  const loadedItems = getLegacyIPSourceAnalysisItems(loaded?.sourceAnalysis);
  assert.equal(loadedItems[0]?.sourceId, saved.id);
  assert.equal(
    loaded?.rawContent.slice(
      loadedItems[0]!.startPosition,
      loadedItems[0]!.endPosition,
    ),
    loadedItems[0]?.originalExcerpt,
  );
});

test("重新解析只替换解析层，不改动Source原文", async () => {
  const {
    addIPOriginalSource,
    getIPOriginalSource,
    replaceIPOriginalSourceAnalysis,
  } = await import("./ip-original-source");
  const originalContent = "老师原话：真正的长期主义不是重复，而是能力持续增长。";
  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "长期主义",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-13T10:00:00.000Z",
      parserVersion: 1,
      items: [],
    },
  });

  replaceIPOriginalSourceAnalysis(saved.id, {
    analyzedAt: "2026-08-13T11:00:00.000Z",
    parserVersion: 1,
    items: [{
      id: "A01",
      kind: "claim",
      content: "长期主义要求能力增长。",
      sourceId: "another-draft-id",
      startPosition: 5,
      endPosition: originalContent.length,
      originalExcerpt: "真正的长期主义不是重复，而是能力持续增长。",
      extractionStatus: "人工确认",
    }],
  });

  const loaded = getIPOriginalSource(saved.id);
  assert.equal(loaded?.rawContent, originalContent);
  const loadedItems = getLegacyIPSourceAnalysisItems(loaded?.sourceAnalysis);
  assert.equal(loadedItems[0]?.sourceId, saved.id);
  assert.equal(loadedItems[0]?.extractionStatus, "人工确认");
});

test("粘贴原文未填写标题时，可从理解结果生成可编辑标题", async () => {
  const { deriveIPOriginalSourceTitle } = await import("./ip-original-source");
  const title = deriveIPOriginalSourceTitle(
    "道德经里有八个字：明道若昧，进道若退。",
    {
      analyzedAt: "2026-08-14T10:00:00.000Z",
      parserVersion: 1,
      items: [{
        id: "A01",
        kind: "claim",
        content: "道德经中的八字很适合解释胖东来的经营理念",
        sourceId: "draft-source",
        startPosition: 0,
        endPosition: 21,
        originalExcerpt: "道德经里有八个字：明道若昧，进道若退。",
        extractionStatus: "AI提取",
      }],
    },
  );

  assert.equal(title, "道德经中的八字很适合解释胖东来的经营理念");
});

test("知识库数据损坏时拒绝新增Source并保留原始损坏数据", async () => {
  const corrupted = "{broken-knowledge-data";
  storage.setItem("ipwr:knowledgeEntries", corrupted);
  const { addIPOriginalSource } = await import("./ip-original-source");
  const originalContent = "老师原话：真正重要的是判断力。";

  assert.throws(() => addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "判断力",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-14T12:00:00.000Z",
      parserVersion: 1,
      items: [{
        id: "A01",
        kind: "claim",
        content: "真正重要的是判断力。",
        sourceId: "draft-source",
        startPosition: 0,
        endPosition: originalContent.length,
        originalExcerpt: originalContent,
        extractionStatus: "AI提取",
      }],
    },
  }), /知识库数据已损坏/);

  assert.equal(storage.getItem("ipwr:knowledgeEntries"), corrupted);
});

test("缺少rawContent等新字段的旧版知识条目仍可保留并追加Source", async () => {
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "legacy-knowledge",
    category: "IP表达语料",
    title: "旧版表达样本",
    ipId: "ip-shuimuran",
    createdAt: "2026-01-01T00:00:00.000Z",
  }]));
  const { addIPOriginalSource } = await import("./ip-original-source");
  const originalContent = "老师原话：真正重要的是判断力。";

  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "判断力",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-15T09:00:00.000Z",
      parserVersion: 1,
      items: [],
    },
  });

  const persisted = JSON.parse(storage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<{ id: string }>;
  assert.deepEqual(persisted.map(entry => entry.id), ["legacy-knowledge", saved.id]);
});

test("知识库存储不是数组或条目缺少基础身份字段时拒绝覆盖", async () => {
  const { addIPOriginalSource } = await import("./ip-original-source");
  const invalidStores = [
    JSON.stringify({ id: "not-an-array" }),
    JSON.stringify([{ id: "broken-entry", category: "IP表达语料" }]),
  ];

  for (const invalidStore of invalidStores) {
    storage.setItem("ipwr:knowledgeEntries", invalidStore);
    assert.throws(() => addIPOriginalSource({
      ipId: "ip-shuimuran",
      title: "判断力",
      sourceKind: "课程内容",
      originalContent: "老师原话：真正重要的是判断力。",
      sourceName: "",
      sourceUrl: "",
      analysis: {
        analyzedAt: "2026-08-15T09:00:00.000Z",
        parserVersion: 1,
        items: [],
      },
    }), /知识库数据已损坏/);
    assert.equal(storage.getItem("ipwr:knowledgeEntries"), invalidStore);
  }
});

test("知识库存储兼容带最终凭证的V2，并拒绝原文哈希不一致的V2记录", async () => {
  const { addIPOriginalSource } = await import("./ip-original-source");
  const { getKnowledgeEntries } = await import("./ip-store");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const originalContent = "老师原话：判断不是追随共识，而是找到共识没有解释的矛盾。";
  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "判断与共识",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-24T10:00:00.000Z",
      parserVersion: 1,
      items: [],
    },
  });
  const stored = JSON.parse(storage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<Record<string, unknown>>;
  stored[0]!.sourceAnalysis = buildIPSourceAnalysisV2({
    sourceId: saved.id,
    sourceContent: originalContent,
    analyzedAt: "2026-08-24T11:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000004",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: {
          content: "判断应该如何形成？",
          derivation: "inferred",
          anchors: [{ quote: originalContent }],
        },
        claim: {
          content: "判断来自共识尚未解释的矛盾。",
          anchors: [{ quote: "找到共识没有解释的矛盾" }],
        },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  stored[0]!.sourceFinalProof = "test-final-proof";
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(stored));

  assert.equal(getKnowledgeEntries("IP原始内容")[0]?.sourceAnalysis?.parserVersion, 2);

  stored[0]!.rawContent = `${originalContent}被篡改`;
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(stored));
  assert.throws(() => getKnowledgeEntries("IP原始内容"), /知识库数据已损坏/);
});

test("V2认知节点全部被拒绝时记录reviewed_none而不是人工确认", async () => {
  const { addVerifiedIPOriginalSource } = await import("./ip-original-source");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const {
    buildIPSourceAnalysisProofClaims,
    createIPSourceAnalysisToken,
    digestIPSourceAnalysisProofClaims,
  } = await import("./ip-source-analysis-proof");
  const { initializeIPSourceLedger } = await import("./ip-source-ledger");
  const { POST: finalizePOST } = await import("../app/api/ip-source-analysis/finalize/route");
  const { POST: verifyPOST } = await import("../app/api/ip-source-analysis/verify/route");
  const { NextRequest } = await import("next/server");
  const sourceId = "source-all-rejected";
  const originalContent = "老师明确说：这条候选观点最终不应进入认知库。";
  const analysis = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: originalContent,
    analyzedAt: "2026-08-24T16:30:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000071",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "这条候选观点是否有效？", derivation: "inferred", anchors: [{ quote: originalContent }] },
        claim: { content: "这条候选观点最终不应进入认知库。", anchors: [{ quote: "这条候选观点最终不应进入认知库" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  analysis.nodes[0]!.reviewStatus = "rejected";
  const ipId = "ip-shuimuran";
  const proofSecret = "test-only-ip-source-analysis-proof-secret-32-bytes";
  const previousSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  const previousFetch = globalThis.fetch;
  let saved;
  try {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = proofSecret;
    const claims = buildIPSourceAnalysisProofClaims({ ipId, analysis });
    await initializeIPSourceLedger({
      sourceId,
      ipId,
      nonce: analysis.nonce,
      digest: digestIPSourceAnalysisProofClaims(claims),
    });
    const finalizeResponse = await finalizePOST(new NextRequest(
      "http://localhost/api/ip-source-analysis/finalize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeIPId: ipId,
          sourceId,
          rawContent: originalContent,
          analysis,
          analysisToken: createIPSourceAnalysisToken(claims, proofSecret),
        }),
      },
    ));
    const finalized = await finalizeResponse.json() as { finalProof?: string };
    assert.equal(finalizeResponse.status, 200);
    assert.equal(typeof finalized.finalProof, "string");
    globalThis.fetch = async (_input, init) => verifyPOST(new NextRequest(
      "http://localhost/api/ip-source-analysis/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: init?.body,
      },
    ));
    saved = await addVerifiedIPOriginalSource({
      sourceId,
      ipId,
      title: "全部拒绝的认知",
      sourceKind: "课程内容",
      originalContent,
      sourceName: "",
      sourceUrl: "",
      analysis,
      finalProof: finalized.finalProof!,
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
    else process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = previousSecret;
  }

  assert.equal(
    (JSON.parse(saved.note) as { analysisStatus?: string }).analysisStatus,
    "reviewed_none",
  );
});

test("V2认知不能绕过最终凭证验证直接写入浏览器知识库", async () => {
  const { addIPOriginalSource } = await import("./ip-original-source");
  const { addKnowledgeEntry, addKnowledgeEntryWithId } = await import("./ip-store");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const sourceId = "source-v2-without-final-proof";
  const originalContent = "老师明确说：没有最终凭证的认知不能入库。";
  const analysis = buildIPSourceAnalysisV2({
    sourceId,
    sourceContent: originalContent,
    analyzedAt: "2026-08-25T09:30:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000082",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "什么不能入库？", derivation: "inferred", anchors: [{ quote: originalContent }] },
        claim: { content: "没有最终凭证的认知不能入库。", anchors: [{ quote: "没有最终凭证的认知不能入库" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  analysis.nodes[0]!.reviewStatus = "human_confirmed";

  assert.throws(() => addIPOriginalSource({
    sourceId,
    ipId: "ip-shuimuran",
    title: "无最终凭证",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis,
  }), /V2认知必须经过服务端最终校验后才能入库/);
  const baseKnowledgeInput = {
    category: "IP原始内容" as const,
    title: "无最终凭证",
    rawContent: originalContent,
    sourceKind: "课程内容" as const,
    sourceName: "",
    sourceAnalysis: analysis,
    sourceFinalProof: null,
    tags: [],
    keywords: [],
    ipId: "ip-shuimuran",
    sourceTier: "中" as const,
    sourceTierReason: "测试",
    contentDirection: [],
    sourcePlatform: "课程内容",
    sourceUrl: "",
    note: "",
    extractedAt: analysis.analyzedAt,
    metrics: null,
    viralEvaluation: null,
    usageRecords: [],
    status: "未使用" as const,
    trustStatus: null,
    sourceReference: null,
    executionTemplate: null,
    dna: null,
  };
  assert.throws(
    () => addKnowledgeEntry(baseKnowledgeInput),
    /V2认知只能通过最终凭证验证入口保存/,
  );
  assert.throws(
    () => addKnowledgeEntryWithId({ id: `${sourceId}-direct`, ...baseKnowledgeInput }),
    /V2认知只能通过最终凭证验证入口保存/,
  );
  assert.equal(localStorage.getItem("ipwr:knowledgeEntries"), null);
});

test("知识库存储拒绝挂在错误知识记录下的合法V2解析数据", async () => {
  const { addIPOriginalSource } = await import("./ip-original-source");
  const { getKnowledgeEntries } = await import("./ip-store");
  const { buildIPSourceAnalysisV2 } = await import("./ip-source-analysis-v2");
  const originalContent = "老师原话：判断不是追随共识，而是找到共识没有解释的矛盾。";
  const saved = addIPOriginalSource({
    ipId: "ip-shuimuran",
    title: "判断与共识",
    sourceKind: "课程内容",
    originalContent,
    sourceName: "",
    sourceUrl: "",
    analysis: {
      analyzedAt: "2026-08-24T10:00:00.000Z",
      parserVersion: 1,
      items: [],
    },
  });
  const stored = JSON.parse(storage.getItem("ipwr:knowledgeEntries") ?? "[]") as Array<Record<string, unknown>>;
  stored[0]!.sourceAnalysis = buildIPSourceAnalysisV2({
    sourceId: saved.id,
    sourceContent: originalContent,
    analyzedAt: "2026-08-24T11:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000006",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: {
          content: "判断应该如何形成？",
          derivation: "inferred",
          anchors: [{ quote: originalContent }],
        },
        claim: {
          content: "判断来自共识尚未解释的矛盾。",
          anchors: [{ quote: "找到共识没有解释的矛盾" }],
        },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  stored[0]!.id = "wrong-knowledge-id";
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify(stored));

  assert.throws(() => getKnowledgeEntries("IP原始内容"), /知识库数据已损坏/);
});
