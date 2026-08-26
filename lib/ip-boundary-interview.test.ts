import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

const interviewModulePath = "./ip-boundary-interview";
const interviewRoutePath = "../app/api/ip-boundary/interview/questions/route";

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
