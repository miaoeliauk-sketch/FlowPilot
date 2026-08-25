import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/ip-source-analysis/route";
import {
  buildIPSourceAnalysisProofClaims,
  verifyIPSourceAnalysisToken,
} from "./ip-source-analysis-proof";
import type { IPSourceAnalysisV2 } from "./types";

const PROOF_SECRET = "test-only-ip-source-analysis-proof-secret-32-bytes";
const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

before(() => {
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = PROOF_SECRET;
});

after(() => {
  if (originalProofSecret === undefined) {
    delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  } else {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
  }
});

function deepSeekResponse(content: string, finishReason = "stop") {
  return new Response(JSON.stringify({
    id: "ip-source-analysis-request",
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function analysisRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ip-source-analysis", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

interface V2CandidateAnchor {
  quote: string;
}

interface V2CandidateStatement {
  content: string;
  anchors: V2CandidateAnchor[];
}

interface V2CandidateNode {
  nodeRef: string;
  question: V2CandidateStatement & {
    derivation: "explicit" | "inferred";
  };
  claim: V2CandidateStatement;
  reasoning: {
    status: "complete" | "partial" | "not_provided";
    steps: Array<V2CandidateStatement & { order: number }>;
  };
  evidence: Array<V2CandidateStatement & {
    type: "case" | "data" | "external_fact" | "analogy" | "counter_example";
  }>;
  concepts: Array<{
    term: string;
    definition: string;
    anchors: V2CandidateAnchor[];
  }>;
  id?: string;
  reviewStatus?: string;
}

interface V2Candidate {
  nodes: V2CandidateNode[];
  aiSuggestions: {
    potentialPrinciples: Array<{ content: string; basedOnNodeRefs: string[] }>;
    topicPotential: Array<{ content: string; basedOnNodeRefs: string[] }>;
  };
}

function v2Candidate(): V2Candidate {
  return {
    nodes: [{
      nodeRef: "N1",
      question: {
        content: "什么样的选题不值得追随？",
        derivation: "explicit",
        anchors: [{ quote: "不要追随热榜。" }],
      },
      claim: {
        content: "不要追随热榜。",
        anchors: [{ quote: "不要追随热榜。" }],
      },
      reasoning: { status: "not_provided", steps: [] },
      evidence: [],
      concepts: [],
    }],
    aiSuggestions: {
      potentialPrinciples: [{ content: "优先寻找非共识角度。", basedOnNodeRefs: ["N1"] }],
      topicPotential: [{ content: "追逐热榜为什么会失效？", basedOnNodeRefs: ["N1"] }],
    },
  };
}

test("V2推理步骤没有逐字原文依据时重试后整体失败", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const candidate = v2Candidate();
  candidate.nodes[0]!.reasoning = {
    status: "partial",
    steps: [{
      order: 1,
      content: "算法会惩罚追随热榜的内容。",
      anchors: [{ quote: "因为算法会惩罚追随热榜的内容。" }],
    }],
  };
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-reasoning",
      activeIPId: "ip-shuimuran",
      rawContent: "老师明确说：不要追随热榜。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /推理.*原文|推理.*回溯/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("should fail when anchor quote is ambiguous within a chunk", async () => {
  const originalFetch = globalThis.fetch;
  const candidate = v2Candidate();
  let calls = 0;
  let retryPrompt = "";
  try {
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      if (calls === 2) {
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        retryPrompt = requestBody.messages?.find(message => message.role === "user")?.content ?? "";
      }
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-ambiguous-anchor",
      activeIPId: "ip-shuimuran",
      rawContent: "不要追随热榜。换一个话题后，老师再次强调：不要追随热榜。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /锚点.*不唯一|锚点.*歧义/);
    assert.match(retryPrompt, /更完整的上下文.*区分重复语句/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2锚点只能在对应分块内定位，不能借用其他分块的相同Source内容", async () => {
  const originalFetch = globalThis.fetch;
  const secondChunkQuote = "第二分块才有的明确观点。";
  const rawContent = `不要追随热榜。${"甲".repeat(8_100)}\n${secondChunkQuote}`;
  let calls = 0;
  const candidate = v2Candidate();
  candidate.nodes[0]!.question = {
    content: "第二分块表达了什么观点？",
    derivation: "explicit",
    anchors: [{ quote: secondChunkQuote }],
  };
  candidate.nodes[0]!.claim = {
    content: secondChunkQuote,
    anchors: [{ quote: secondChunkQuote }],
  };
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-chunk-scope",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /当前分块.*原文|原文.*当前分块/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2不会把横跨分块边界的半句话拼成一个虚假锚点", async () => {
  const originalFetch = globalThis.fetch;
  const crossBoundaryQuote = "老师说要坚持。";
  const rawContent = `${"甲".repeat(7_997)}${crossBoundaryQuote}`;
  const candidate = v2Candidate();
  candidate.nodes[0]!.question = {
    content: "老师强调了什么？",
    derivation: "explicit",
    anchors: [{ quote: crossBoundaryQuote }],
  };
  candidate.nodes[0]!.claim = {
    content: crossBoundaryQuote,
    anchors: [{ quote: crossBoundaryQuote }],
  };
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-cross-boundary-anchor",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /当前分块.*原文|原文.*当前分块/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2的AI建议引用不存在的nodeRef时重试后整体失败", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const candidate = v2Candidate();
  candidate.aiSuggestions.topicPotential[0]!.basedOnNodeRefs = ["N404"];
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-unknown-reference",
      activeIPId: "ip-shuimuran",
      rawContent: "老师明确说：不要追随热榜。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /不存在的认知节点/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2成功结果由服务端生成UUID、全文哈希和绝对锚点位置", async () => {
  const originalFetch = globalThis.fetch;
  const rawContent = "老师明确说：不要追随热榜。";
  const candidate = v2Candidate();
  Object.assign(candidate.nodes[0]!, {
    id: "forged-node-id",
    reviewStatus: "human_confirmed",
  });
  let systemPrompt = "";
  try {
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      systemPrompt = requestBody.messages?.find(message => message.role === "system")?.content ?? "";
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-success",
      activeIPId: "ip-shuimuran",
      rawContent,
      requestSeq: 37,
    }));
    const body = await response.json();
    const node = body.analysis.nodes[0];

    assert.equal(response.status, 200);
    assert.equal(body.analysis.parserVersion, 2);
    assert.equal(body.analysis.sourceId, "source-v2-success");
    assert.equal(body.activeIPId, "ip-shuimuran");
    assert.equal(body.requestSeq, 37);
    assert.equal(verifyIPSourceAnalysisToken(
      body.analysisToken,
      buildIPSourceAnalysisProofClaims({
        ipId: "ip-shuimuran",
        analysis: body.analysis as IPSourceAnalysisV2,
      }),
      PROOF_SECRET,
    ), true);
    assert.equal(
      body.analysis.sourceHash,
      createHash("sha256").update(rawContent, "utf8").digest("hex"),
    );
    assert.match(node.id, /^[0-9a-f-]{36}$/i);
    assert.notEqual(node.id, "forged-node-id");
    assert.equal(node.reviewStatus, "ai_extracted");
    assert.equal(
      rawContent.slice(node.claim.anchors[0].startPosition, node.claim.anchors[0].endPosition),
      node.claim.anchors[0].quote,
    );
    assert.match(systemPrompt, /先逐字锁定原文quote/);
    assert.match(systemPrompt, /不得补齐缺失步骤/);
    assert.match(systemPrompt, /not_provided且steps必须为空/);
    assert.match(systemPrompt, /不得自行补充/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2输出即使能解析成JSON，finish_reason为length时仍重试后整体失败", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify(v2Candidate()), "length");
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-truncated",
      activeIPId: "ip-shuimuran",
      rawContent: "老师明确说：不要追随热榜。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2多分块成功时把相对锚点换算为全文绝对位置", async () => {
  const originalFetch = globalThis.fetch;
  const firstQuote = "第一分块的明确观点。";
  const secondQuote = "第二分块的明确观点。";
  const rawContent = `${firstQuote}${"甲".repeat(8_100)}\n${secondQuote}`;
  let calls = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const userPrompt = requestBody.messages?.find(message => message.role === "user")?.content ?? "";
      const quote = userPrompt.includes(secondQuote) ? secondQuote : firstQuote;
      const candidate = v2Candidate();
      candidate.nodes[0]!.question = {
        content: `${quote}回答的问题`,
        derivation: "explicit",
        anchors: [{ quote }],
      };
      candidate.nodes[0]!.claim = {
        content: quote,
        anchors: [{ quote }],
      };
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-chunks",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(body.analysis.nodes.length, 2);
    assert.equal(body.analysis.nodes[0].claim.anchors[0].startPosition, rawContent.indexOf(firstQuote));
    assert.equal(body.analysis.nodes[1].claim.anchors[0].startPosition, rawContent.indexOf(secondQuote));
    for (const node of body.analysis.nodes) {
      const anchor = node.claim.anchors[0];
      assert.equal(rawContent.slice(anchor.startPosition, anchor.endPosition), anchor.quote);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2多分块合并后重新校验整份结果，拒绝全局重复的服务端节点ID", async () => {
  const originalFetch = globalThis.fetch;
  const originalRandomUUIDDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.crypto,
    "randomUUID",
  );
  const repeatedUUID = "11111111-1111-4111-8111-111111111111";
  const firstQuote = "第一分块的明确观点。";
  const secondQuote = "第二分块的明确观点。";
  const rawContent = `${firstQuote}${"甲".repeat(8_100)}\n${secondQuote}`;

  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => repeatedUUID,
    });
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const userPrompt = requestBody.messages?.find(message => message.role === "user")?.content ?? "";
      const quote = userPrompt.includes(secondQuote) ? secondQuote : firstQuote;
      const candidate = v2Candidate();
      candidate.nodes[0]!.question = {
        content: `${quote}回答的问题`,
        derivation: "explicit",
        anchors: [{ quote }],
      };
      candidate.nodes[0]!.claim = { content: quote, anchors: [{ quote }] };
      return deepSeekResponse(JSON.stringify(candidate));
    };
    const response = await POST(analysisRequest({
      parserVersion: 2,
      sourceId: "source-v2-global-duplicate-id",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRandomUUIDDescriptor) {
      Object.defineProperty(globalThis.crypto, "randomUUID", originalRandomUUIDDescriptor);
    } else {
      Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    }
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID"),
      originalRandomUUIDDescriptor,
    );
  }
});

test("不支持的解析版本返回400且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse("{}");
    };
    const response = await POST(analysisRequest({
      parserVersion: 3,
      sourceId: "source-invalid-version",
      activeIPId: "ip-shuimuran",
      rawContent: "老师明确说：不要追随热榜。",
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "不支持的解析版本" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("解析结果由服务端根据原文快照生成准确位置，不接受AI自报位置", async () => {
  const originalFetch = globalThis.fetch;
  const rawContent = "很多人以为持续输出就是每天更新。真正的问题不是频率，而是有没有围绕同一个问题持续回答。";
  try {
    globalThis.fetch = async () => deepSeekResponse(JSON.stringify({
      items: [{
        kind: "claim",
        content: "持续输出的关键不是更新频率。",
        originalExcerpt: "真正的问题不是频率，而是有没有围绕同一个问题持续回答。",
        startPosition: 999,
        endPosition: 1000,
        extractionStatus: "人工确认",
      }],
    }));
    const response = await POST(analysisRequest({
      sourceId: "draft-source-1",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();
    const item = body.analysis.items[0];

    assert.equal(response.status, 200);
    assert.equal(item.sourceId, "draft-source-1");
    assert.equal(item.originalExcerpt, "真正的问题不是频率，而是有没有围绕同一个问题持续回答。");
    assert.equal(rawContent.slice(item.startPosition, item.endPosition), item.originalExcerpt);
    assert.equal(item.extractionStatus, "AI提取");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI给出的内容在原文中无法定位时，解析失败且不返回无出处条目", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify({
        items: [{
          kind: "claim",
          content: "老师从未表达过的新观点。",
          originalExcerpt: "这句话在原文中并不存在。",
        }],
      }));
    };
    const response = await POST(analysisRequest({
      sourceId: "draft-source-2",
      activeIPId: "ip-shuimuran",
      rawContent: "老师只说：做内容要先回答真实问题。",
    }));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(calls, 2);
    assert.match(body.error, /原文|出处|定位/);
    assert.equal(body.analysis, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("长逐字稿分段解析后仍统一回溯到完整Source位置", async () => {
  const originalFetch = globalThis.fetch;
  const firstExcerpt = "第一部分的核心判断。";
  const secondExcerpt = "第二部分的核心判断。";
  const rawContent = `${firstExcerpt}${"甲".repeat(8_100)}\n${secondExcerpt}`;
  let calls = 0;
  try {
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const requestBody = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: string }>;
      };
      const prompt = requestBody.messages?.map(message => message.content ?? "").join("\n") ?? "";
      const excerpt = prompt.includes(secondExcerpt) ? secondExcerpt : firstExcerpt;
      return deepSeekResponse(JSON.stringify({
        items: [{ kind: "claim", content: excerpt, originalExcerpt: excerpt }],
      }));
    };
    const response = await POST(analysisRequest({
      sourceId: "long-source",
      activeIPId: "ip-shuimuran",
      rawContent,
    }));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(
      body.analysis.items.map((item: { originalExcerpt: string }) => item.originalExcerpt),
      [firstExcerpt, secondExcerpt],
    );
    for (const item of body.analysis.items) {
      assert.equal(rawContent.slice(item.startPosition, item.endPosition), item.originalExcerpt);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("请求体是null等非法结构时返回请求格式错误且不调用AI", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse(JSON.stringify({ items: [] }));
    };
    const response = await POST(analysisRequest(null));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "请求格式错误" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
