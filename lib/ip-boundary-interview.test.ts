import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const interviewModulePath = "./ip-boundary-interview";
const interviewRoutePath = "../app/api/ip-boundary/interview/questions/route";
const interviewExtractRoutePath = "../app/api/ip-boundary/interview/extract/route";

const INTERVIEW_QUESTION = "老师，关于停止学习这个话题，您的真实判断是什么？";
const INTERVIEW_ANSWER = "  我认为停止学习能消化知识，因为大脑需要空白期，比如我去年闭关一个月后效率更高了。\n";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestInterviewExtraction() {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            nodes: [{
              nodeRef: "N1",
              question: {
                content: "为什么停止学习能帮助消化知识？",
                derivation: "inferred",
                anchors: [{ quote: "停止学习能消化知识" }],
              },
              claim: {
                content: "停止学习能消化知识。",
                anchors: [{ quote: "停止学习能消化知识" }],
              },
              reasoning: {
                status: "complete",
                steps: [{
                  order: 1,
                  content: "大脑需要空白期。",
                  anchors: [{ quote: "大脑需要空白期" }],
                }],
              },
              evidence: [{
                type: "case",
                content: "去年闭关一个月后效率更高。",
                anchors: [{ quote: "我去年闭关一个月后效率更高了" }],
              }],
              concepts: [],
            }],
            aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
          }),
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const { POST } = await import(interviewExtractRoutePath);
    return await POST(new NextRequest("http://localhost/api/ip-boundary/interview/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "test-key",
      },
      body: JSON.stringify({
        activeIPId: "ip-interview-extract",
        topicId: "topic-interview-extract",
        interviewId: "interview-extract-v1",
        rawInteraction: [{
          questionId: "question-claim",
          question: INTERVIEW_QUESTION,
          answer: INTERVIEW_ANSWER,
        }],
      }),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("NONE访谈拒绝带预设立场的问题并在重试后报告INVALID_RESPONSE", async () => {
  const { generateInterviewQuestions } = await import(interviewModulePath);
  let attempts = 0;

  await assert.rejects(
    generateInterviewQuestions({
      activeIPId: "ip-interview-none",
      topicId: "topic-interview-none",
      interviewId: "interview-none-v1",
      topic: "普通人是否应该停止学习新知识？",
      coverage: "NONE",
      missingElements: ["CLAIM"],
      contextNodes: [{
        nodeId: "node-that-must-not-enter-none",
        claim: "停止学习是为了消化知识。",
      }],
      callModel: async () => {
        attempts += 1;
        return {
          questions: [{
            id: "question-leading",
            missingElement: "CLAIM",
            content: "老师，您是否也认为停止学习才是正确选择？",
            basedOnNodeIds: ["node-that-must-not-enter-none"],
          }],
        };
      },
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "INVALID_RESPONSE"
    ),
  );

  assert.equal(attempts, 2, "诱导性回答只允许纠正重试一次");
});

test("NONE访谈在调用模型前物理清空认知节点且问题不绑定NodeID", async () => {
  const { generateInterviewQuestions } = await import(interviewModulePath);
  const capturedRequests: unknown[] = [];

  const result = await generateInterviewQuestions({
    activeIPId: "ip-interview-structure",
    topicId: "topic-interview-structure",
    interviewId: "interview-structure-v1",
    topic: "老师如何看待陌生的新话题？",
    coverage: "NONE",
    missingElements: ["CLAIM"],
    contextNodes: [{
      nodeId: "node-must-be-removed",
      claim: "一条不应进入NONE访谈的旧观点。",
    }],
    callModel: async (request: unknown) => {
      capturedRequests.push(request);
      return {
        questions: [{
          id: "question-open",
          missingElement: "CLAIM",
          content: "老师，关于这个话题，您的核心主张是什么？",
          basedOnNodeIds: [],
        }],
      };
    },
  });

  assert.equal(capturedRequests.length, 1);
  assert.deepEqual(
    (capturedRequests[0] as { contextNodes?: unknown[] }).contextNodes,
    [],
  );
  assert.deepEqual(result.questions[0]?.basedOnNodeIds, []);
});

test("访谈问题接口缺少activeIPId时在调用AI前返回403", async () => {
  const { POST } = await import(interviewRoutePath);
  const response = await POST(new NextRequest(
    "http://localhost/api/ip-boundary/interview/questions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DeepSeek-Key": "test-key-must-not-be-used",
      },
      body: JSON.stringify({
        topicId: "topic-missing-ip",
        interviewId: "interview-missing-ip-v1",
        topic: "一个缺少IP归属的选题",
        coverage: "NONE",
        missingElements: ["CLAIM"],
      }),
    },
  ));

  assert.equal(response.status, 403);
});

test("访谈提取接口把一段口语回答拆成观点、推理和亲历案例", async () => {
  const response = await requestInterviewExtraction();
  assert.equal(response.status, 200);
  const payload: unknown = await response.json();
  assert.ok(isRecord(payload));
  assert.ok(Array.isArray(payload.candidates));
  assert.equal(payload.candidates.length, 1);

  const candidate: unknown = payload.candidates[0];
  assert.ok(isRecord(candidate));
  assert.ok(isRecord(candidate.node));
  assert.ok(isRecord(candidate.node.claim));
  assert.equal(candidate.node.claim.content, "停止学习能消化知识。");
  assert.ok(isRecord(candidate.node.reasoning));
  assert.ok(Array.isArray(candidate.node.reasoning.steps));
  assert.equal(candidate.node.reasoning.steps.length, 1);
  assert.ok(isRecord(candidate.node.reasoning.steps[0]));
  assert.equal(candidate.node.reasoning.steps[0].content, "大脑需要空白期。");
  assert.ok(Array.isArray(candidate.node.evidence));
  assert.equal(candidate.node.evidence.length, 1);
  assert.ok(isRecord(candidate.node.evidence[0]));
  assert.equal(candidate.node.evidence[0].type, "case");
  assert.equal(candidate.node.evidence[0].content, "去年闭关一个月后效率更高。");
});

test("访谈候选节点强引用保留完整问答原文的InterviewSource", async () => {
  const response = await requestInterviewExtraction();
  assert.equal(response.status, 200);
  const payload: unknown = await response.json();
  assert.ok(isRecord(payload));
  assert.ok(isRecord(payload.source));
  assert.equal(payload.source.ipId, "ip-interview-extract");
  assert.equal(payload.source.topicId, "topic-interview-extract");
  assert.equal(payload.source.interviewId, "interview-extract-v1");
  assert.deepEqual(payload.source.rawInteraction, [{
    questionId: "question-claim",
    question: INTERVIEW_QUESTION,
    answer: INTERVIEW_ANSWER,
  }]);
  assert.equal(typeof payload.source.id, "string");
  assert.ok(typeof payload.source.timestamp === "string" && !Number.isNaN(Date.parse(payload.source.timestamp)));

  assert.ok(Array.isArray(payload.candidates));
  assert.ok(isRecord(payload.candidates[0]));
  assert.equal(payload.candidates[0].sourceId, payload.source.id);
});

test("访谈长期终审只接受一次原始凭证并返回可持久化的最终凭证", async () => {
  const proofSecret = "test-only-interview-confirm-proof-secret-32-bytes";
  const originalProofSecret = process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
  process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = proofSecret;
  try {
    const { resetIPSourceLedgerForTests } = await import("./ip-source-ledger");
    await resetIPSourceLedgerForTests();
    const extractedResponse = await requestInterviewExtraction();
    assert.equal(extractedResponse.status, 200);
    const extracted: unknown = await extractedResponse.json();
    assert.ok(isRecord(extracted));
    assert.ok(isRecord(extracted.source));
    assert.ok(isRecord(extracted.analysis));
    assert.ok(typeof extracted.analysisToken === "string" && extracted.analysisToken.length > 20);
    assert.ok(Array.isArray(extracted.candidates) && extracted.candidates.length === 1);
    const candidate = extracted.candidates[0];
    assert.ok(isRecord(candidate) && isRecord(candidate.node) && typeof candidate.node.id === "string");

    const body = {
      mode: "long_term",
      activeIPId: "ip-interview-extract",
      topicId: "topic-interview-extract",
      interviewId: "interview-extract-v1",
      source: extracted.source,
      analysis: extracted.analysis,
      analysisToken: extracted.analysisToken,
      actions: [{ type: "confirm", nodeId: candidate.node.id }],
    };
    const { POST } = await import("../app/api/ip-boundary/interview/confirm/route");
    const request = () => new NextRequest("http://localhost/api/ip-boundary/interview/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const first = await POST(request());
    assert.equal(first.status, 200);
    const confirmed: unknown = await first.json();
    assert.ok(isRecord(confirmed));
    assert.equal(confirmed.mode, "long_term");
    assert.ok(typeof confirmed.finalProof === "string" && confirmed.finalProof.length > 20);
    assert.ok(isRecord(confirmed.analysis));
    assert.ok(Array.isArray(confirmed.analysis.nodes));
    assert.ok(confirmed.analysis.nodes.every(node => isRecord(node) && node.reviewStatus !== "ai_extracted"));

    const replay = await POST(request());
    assert.equal(replay.status, 409, "原始访谈凭证不得重复确认入库");
  } finally {
    if (originalProofSecret === undefined) {
      delete process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET;
    } else {
      process.env.FLOWPILOT_IP_SOURCE_ANALYSIS_PROOF_SECRET = originalProofSecret;
    }
  }
});
