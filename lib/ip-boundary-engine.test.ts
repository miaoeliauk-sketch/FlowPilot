import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";

import type { BoundaryReport } from "./ip-boundary-engine";
import {
  buildEphemeralCognitionProofClaims,
  createEphemeralCognitionProof,
} from "./ip-boundary-interview-proof";
import {
  buildIPSourceAnalysisProofClaims,
  buildIPSourceFinalProofClaims,
  createIPSourceFinalProof,
  digestIPSourceAnalysisProofClaims,
  digestIPSourceFinalProofClaims,
} from "./ip-source-analysis-proof";
import {
  finalizeIPSourceLedger,
  initializeIPSourceLedger,
  resetIPSourceLedgerForTests,
} from "./ip-source-ledger";
import {
  buildIPSourceAnalysisV2,
  toV1CompatibleItems,
} from "./ip-source-analysis-v2";

const PROOF_SECRET = "test-only-ip-boundary-proof-secret-at-least-32-bytes";
const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;

interface ConfirmedSourceInput {
  sourceId: string;
  rawContent: string;
  analysis: ReturnType<typeof buildIPSourceAnalysisV2>;
  finalProof: string;
}

before(async () => {
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = PROOF_SECRET;
  await resetIPSourceLedgerForTests();
});

after(async () => {
  await resetIPSourceLedgerForTests();
  if (originalProofSecret === undefined) {
    delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  } else {
    process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
  }
});

function deepSeekResponse(report: BoundaryReport) {
  return new Response(JSON.stringify({
    id: "ip-boundary-request",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(report) } }],
    usage: { prompt_tokens: 100, completion_tokens: 100 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function boundaryRequest(body: unknown) {
  return new NextRequest("http://localhost/api/ip-boundary/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

async function createConfirmedSource(input: {
  ipId: string;
  sourceId: string;
  question?: string;
  claim: string;
  additionalClaims?: string[];
  reasoningSteps?: string[];
  evidence?: string[];
  humanRevision?: string;
}): Promise<ConfirmedSourceInput> {
  const reasoningSteps = input.reasoningSteps ?? [];
  const evidence = input.evidence ?? [];
  const claims = [input.claim, ...(input.additionalClaims ?? [])];
  const rawContent = [...claims, ...reasoningSteps, ...evidence].join("\n");
  let nextId = 0;
  const analysis = buildIPSourceAnalysisV2({
    sourceId: input.sourceId,
    sourceContent: rawContent,
    analyzedAt: "2026-08-26T10:00:00.000Z",
    createId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    candidate: {
      nodes: claims.map((claim, nodeIndex) => ({
        nodeRef: `N${nodeIndex + 1}`,
        question: {
          content: nodeIndex === 0 ? input.question ?? "这个问题应该如何判断？" : `如何理解观点${nodeIndex + 1}？`,
          derivation: "inferred" as const,
          anchors: [{ quote: claim }],
        },
        claim: { content: claim, anchors: [{ quote: claim }] },
        reasoning: nodeIndex === 0 ? {
          status: reasoningSteps.length > 0 ? "complete" as const : "not_provided" as const,
          steps: reasoningSteps.map((content, index) => ({
            order: index + 1,
            content,
            anchors: [{ quote: content }],
          })),
        } : { status: "not_provided" as const, steps: [] },
        evidence: nodeIndex === 0 ? evidence.map(content => ({
          type: "case" as const,
          content,
          anchors: [{ quote: content }],
        })) : [],
        concepts: [],
      })),
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
  analysis.nodes.forEach(node => { node.reviewStatus = "human_confirmed"; });
  if (input.humanRevision) {
    analysis.nodes[0]!.humanRevision = {
      claim: input.humanRevision,
      updatedAt: "2026-08-26T10:05:00.000Z",
    };
  }

  const contextItems = toV1CompatibleItems(analysis);
  const analysisClaims = buildIPSourceAnalysisProofClaims({ ipId: input.ipId, analysis });
  const finalClaims = buildIPSourceFinalProofClaims({
    ipId: input.ipId,
    analysis,
    contextItems,
  });
  assert.equal(await initializeIPSourceLedger({
    sourceId: analysis.sourceId,
    ipId: input.ipId,
    nonce: analysis.nonce,
    digest: digestIPSourceAnalysisProofClaims(analysisClaims),
  }), true);
  assert.equal(await finalizeIPSourceLedger({
    sourceId: analysis.sourceId,
    ipId: input.ipId,
    expectedNonce: analysis.nonce,
    expectedDigest: digestIPSourceAnalysisProofClaims(analysisClaims),
    finalDigest: digestIPSourceFinalProofClaims(finalClaims),
  }), true);

  return {
    sourceId: analysis.sourceId,
    rawContent,
    analysis,
    finalProof: createIPSourceFinalProof(finalClaims, PROOF_SECRET),
  };
}

async function postBoundaryCheck(input: {
  activeIPId: string;
  topic: string;
  sources: ConfirmedSourceInput[];
  topicId?: string;
  temporaryContext?: unknown;
  includeEvidence?: boolean;
}) {
  const { POST } = await import("../app/api/ip-boundary/check/route");
  return POST(boundaryRequest(input));
}

test("合法临时凭证在没有长期来源时只为绑定选题完成边界审计", async () => {
  const activeIPId = "ip-boundary-ephemeral";
  const topicId = "topic-boundary-ephemeral";
  const topic = "为什么知识越学越多，行动力反而越差？";
  const source = await createConfirmedSource({
    ipId: activeIPId,
    sourceId: "source-boundary-ephemeral",
    claim: "知识淤积会导致行动瘫痪。",
    reasoningSteps: ["停止继续输入，才能开始消化。"],
  });
  const nodeId = source.analysis.nodes[0]!.id;
  const claims = buildEphemeralCognitionProofClaims({
    ipId: activeIPId,
    topicId,
    topic,
    sourceId: source.sourceId,
    analysis: source.analysis,
    issuedAt: Date.now() - 1_000,
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "FULL",
      stance: "ALIGNED",
      explanation: "本次访谈补充了观点和推理。",
      matchedNodeIds: [nodeId],
      conflictingNodeIds: [],
      supportedParts: ["知识淤积导致行动瘫痪"],
      missingElements: [],
    });
    const response = await postBoundaryCheck({
      activeIPId,
      topicId,
      topic,
      sources: [],
      temporaryContext: {
        activeIPId,
        topicId,
        sourceId: source.sourceId,
        rawContent: source.rawContent,
        analysis: source.analysis,
        temporaryProof: createEphemeralCognitionProof(claims, PROOF_SECRET),
        expiresAt: claims.expiresAt,
      },
      includeEvidence: true,
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.report.coverage, "FULL");
    assert.equal(body.evidenceNodes[0].nodeId, nodeId);
    assert.equal(body.evidenceNodes[0].source, "ephemeral");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("明确反对选题但缺少完整反驳推理时判为部分覆盖且立场冲突", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-conflicting",
    sourceId: "source-boundary-conflicting",
    claim: "持续输出不等于日更。",
  });
  const nodeId = source.analysis.nodes[0]!.id;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "PARTIAL",
      stance: "CONFLICTING",
      explanation: "老师明确反对把持续输出等同于日更，但未提供完整的涨粉反驳路径。",
      matchedNodeIds: [],
      conflictingNodeIds: [nodeId],
      supportedParts: ["持续输出不等于日更"],
      missingElements: ["REASONING"],
    });
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-conflicting",
      topic: "如何通过疯狂日更快速涨粉？",
      sources: [source],
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      coverage: "PARTIAL",
      stance: "CONFLICTING",
      explanation: "老师明确反对把持续输出等同于日更，但未提供完整的涨粉反驳路径。",
      matchedNodeIds: [],
      conflictingNodeIds: [nodeId],
      supportedParts: ["持续输出不等于日更"],
      missingElements: ["REASONING"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("观点和完整推理均能支撑选题时判为全覆盖且立场契合", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-full",
    sourceId: "source-boundary-full",
    claim: "停止学习是为了消化已有知识。",
    reasoningSteps: ["知识淤积会导致行动瘫痪。", "停止继续输入，才能开始消化。"],
  });
  const nodeId = source.analysis.nodes[0]!.id;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "FULL",
      stance: "ALIGNED",
      explanation: "观点和因果路径都能直接回答该选题。",
      matchedNodeIds: [nodeId],
      conflictingNodeIds: [],
      supportedParts: ["知识淤积导致行动瘫痪", "停止输入是为了消化"],
      missingElements: [],
    });
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-full",
      topic: "为什么知识越学越多，行动力反而越差？",
      sources: [source],
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).coverage, "FULL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("选题方向一致但缺少承诺的具体案例时判为部分覆盖", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-partial",
    sourceId: "source-boundary-partial",
    claim: "精准减负的核心是削减决策成本。",
    humanRevision: "精准减负不是堆更多工具，而是削减决策成本。",
  });
  const nodeId = source.analysis.nodes[0]!.id;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "PARTIAL",
      stance: "ALIGNED",
      explanation: "人工修订后的观点支持减负方向，但没有任何具体工具案例。",
      matchedNodeIds: [nodeId],
      conflictingNodeIds: [],
      supportedParts: ["通过削减决策成本实现精准减负"],
      missingElements: ["CASE"],
    });
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-partial",
      topic: "推荐5个能帮IP精准减负的AI工具。",
      sources: [source],
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.coverage, "PARTIAL");
    assert.equal(body.stance, "ALIGNED");
    assert.deepEqual(body.missingElements, ["CASE"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("现有认知与选题无关时判为无覆盖且立场无法判断", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-none",
    sourceId: "source-boundary-none",
    claim: "内容选题需要制造真实冲突。",
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "NONE",
      stance: "UNDETERMINED",
      explanation: "现有认知只涉及内容创作，不能支撑基金投资判断。",
      matchedNodeIds: [],
      conflictingNodeIds: [],
      supportedParts: [],
      missingElements: ["CLAIM", "REASONING", "DATA"],
    });
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-none",
      topic: "如何通过基金定投实现复利增长？",
      sources: [source],
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).stance, "UNDETERMINED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("最终凭证被篡改时在调用AI前拒绝边界判断", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-proof",
    sourceId: "source-boundary-proof",
    claim: "真实判断必须有原文依据。",
  });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      return deepSeekResponse({
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: "不应执行到这里。",
        matchedNodeIds: [source.analysis.nodes[0]!.id],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: [],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-proof",
      topic: "为什么判断必须有依据？",
      sources: [{ ...source, finalProof: `${source.finalProof}tampered` }],
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "认知来源凭证无效或已失效",
      code: "SECURITY_VALIDATION_FAILED",
    });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型引用不存在的认知节点时重试后整次失败", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-unknown-node",
    sourceId: "source-boundary-unknown-node",
    claim: "持续输出来自问题深化。",
  });
  let calls = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse({
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: "模型错误引用了未提供的节点。",
        matchedNodeIds: ["node-does-not-exist"],
        conflictingNodeIds: [],
        supportedParts: ["问题深化"],
        missingElements: [],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-unknown-node",
      topic: "为什么持续输出依赖问题深化？",
      sources: [source],
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "边界判断结果引用了不存在的认知节点",
      code: "BOUNDARY_RESPONSE_INVALID",
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("全覆盖没有真实节点或具体支撑内容时重试后整次失败", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-full-without-proof",
    sourceId: "source-boundary-full-without-proof",
    claim: "持续输出来自问题深化。",
  });
  let calls = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return deepSeekResponse({
        coverage: "FULL",
        stance: "UNDETERMINED",
        explanation: "模型声称全覆盖，但没有提供任何认知依据。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: [],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-full-without-proof",
      topic: "为什么持续输出依赖问题深化？",
      sources: [source],
    });

    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "BOUNDARY_RESPONSE_INVALID");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("发送给AI的节点包含核心问题且只保留人工修订后的观点", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-revision",
    sourceId: "source-boundary-revision",
    question: "精准减负究竟要减少什么？",
    claim: "原始版本：精准减负就是增加更多工具。",
    evidence: ["课程里使用过一次减负工具。"],
    humanRevision: "人工修订：精准减负是削减决策成本。",
  });
  const nodeId = source.analysis.nodes[0]!.id;
  let userPrompt = "";
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      userPrompt = requestBody.messages.find(message => message.role === "user")?.content ?? "";
      return deepSeekResponse({
        coverage: "FULL",
        stance: "ALIGNED",
        explanation: "人工确认后的观点和问题语境共同支撑该选题。",
        matchedNodeIds: [nodeId],
        conflictingNodeIds: [],
        supportedParts: ["削减决策成本"],
        missingElements: [],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-revision",
      topic: "精准减负应该先减少什么？",
      sources: [source],
    });

    assert.equal(response.status, 200);
    assert.match(userPrompt, /精准减负究竟要减少什么/);
    assert.match(userPrompt, /人工修订：精准减负是削减决策成本/);
    assert.doesNotMatch(userPrompt, /原始版本：精准减负就是增加更多工具/);
    assert.match(userPrompt, /"reviewStatus":"human_confirmed"/);
    assert.match(userPrompt, /"verificationStatus":"unverified"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("合法凭证不属于当前IP时整次拒绝且不调用AI", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-owner-a",
    sourceId: "source-boundary-owner-a",
    claim: "选题判断必须来自当前IP。",
  });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      return deepSeekResponse({
        coverage: "NONE",
        stance: "UNDETERMINED",
        explanation: "不应执行到这里。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: ["CLAIM"],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-owner-b",
      topic: "如何判断这个选题？",
      sources: [source],
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "SECURITY_VALIDATION_FAILED");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("序列化后的认知Payload超过12000字节时在调用AI前返回413", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-oversized",
    sourceId: "source-boundary-oversized",
    claim: "大量短证据也会产生不可忽略的JSON结构开销。",
    evidence: Array.from(
      { length: 250 },
      (_, index) => `短例[${String(index + 1).padStart(4, "0")}]。`,
    ),
  });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      return deepSeekResponse({
        coverage: "NONE",
        stance: "UNDETERMINED",
        explanation: "不应执行到这里。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: ["CLAIM"],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-oversized",
      topic: "这条认知能否支持选题？",
      sources: [source],
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "本次认知判断请求超过12000字节，请缩小判断范围",
      code: "BOUNDARY_CONTEXT_TOO_LARGE",
    });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("用户内容未超限但完整AI请求体超过12000字节时仍返回413", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-envelope-limit",
    sourceId: "source-boundary-envelope-limit",
    claim: "原始观点保持简短。",
    evidence: [`证据：${"壳".repeat(3_050)}`],
  });
  let requestBytes = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      requestBytes = new TextEncoder().encode(String(init?.body)).byteLength;
      return deepSeekResponse({
        coverage: "FULL",
        stance: "UNDETERMINED",
        explanation: "不应执行到这里。",
        matchedNodeIds: [source.analysis.nodes[0]!.id],
        conflictingNodeIds: [],
        supportedParts: ["人工修订"],
        missingElements: [],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-envelope-limit",
      topic: "这个事实型选题是否已有完整资料？",
      sources: [source],
    });

    assert.equal(requestBytes, 0, `不应发送超限请求，实际请求体为${requestBytes}字节`);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "本次认知判断请求超过12000字节，请缩小判断范围",
      code: "BOUNDARY_CONTEXT_TOO_LARGE",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("首次请求未超限但追加纠错要求后超过12000字节时终止重试", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-retry-limit",
    sourceId: "source-boundary-retry-limit",
    claim: "原始观点保持简短。",
    evidence: [`证据：${"重".repeat(2_990)}`],
  });
  const requestSizes: number[] = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      requestSizes.push(new TextEncoder().encode(String(init?.body)).byteLength);
      return new Response(JSON.stringify({
        id: "ip-boundary-invalid-response",
        choices: [{ finish_reason: "stop", message: { content: "{\"coverage\":\"FULL\"}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-retry-limit",
      topic: "这个事实型选题是否已有完整资料？",
      sources: [source],
    });

    assert.equal(requestSizes.length, 1, `重试前应熔断，实际请求体为${requestSizes.join(",")}字节`);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "本次认知判断请求超过12000字节，请缩小判断范围",
      code: "BOUNDARY_CONTEXT_TOO_LARGE",
    });
    assert.ok(requestSizes[0]! <= 12_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("完整反对证据允许FULL与CONFLICTING同时成立", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-full-conflicting",
    sourceId: "source-boundary-full-conflicting",
    claim: "疯狂日更会消耗判断力，不能作为长期增长方法。",
    reasoningSteps: ["日更迫使团队追求数量。", "数量压力会挤压选题判断。"],
  });
  const nodeId = source.analysis.nodes[0]!.id;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => deepSeekResponse({
      coverage: "FULL",
      stance: "CONFLICTING",
      explanation: "节点包含完整的反对观点和推理。",
      matchedNodeIds: [],
      conflictingNodeIds: [nodeId],
      supportedParts: ["疯狂日更不适合作为长期增长方法"],
      missingElements: [],
    });
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-full-conflicting",
      topic: "如何通过疯狂日更实现长期增长？",
      sources: [source],
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).stance, "CONFLICTING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("单次超过200个认知节点时返回明确的400且不调用AI", async () => {
  const source = await createConfirmedSource({
    ipId: "ip-boundary-too-many-nodes",
    sourceId: "source-boundary-too-many-nodes",
    claim: "观点1。",
    additionalClaims: Array.from({ length: 200 }, (_, index) => `观点${index + 2}。`),
  });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      return deepSeekResponse({
        coverage: "NONE",
        stance: "UNDETERMINED",
        explanation: "不应执行到这里。",
        matchedNodeIds: [],
        conflictingNodeIds: [],
        supportedParts: [],
        missingElements: ["CLAIM"],
      });
    };
    const response = await postBoundaryCheck({
      activeIPId: "ip-boundary-too-many-nodes",
      topic: "如何判断这个选题？",
      sources: [source],
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "单次最多判断200个认知节点，请先筛选",
      code: "BOUNDARY_NODE_LIMIT_EXCEEDED",
    });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
