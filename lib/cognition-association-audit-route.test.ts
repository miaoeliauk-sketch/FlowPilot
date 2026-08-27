import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { AssociationAuditReport } from "./cognition-association-audit";
import type { CognitionNodeV2 } from "./types";

const routeModulePath = "../app/api/cognition/audit/route";
const routeHandlerModulePath = "./cognition-association-audit-route";

function node(id: string): CognitionNodeV2 {
  return {
    id,
    question: { content: "如何沉淀认知？", anchors: [], derivation: "explicit" },
    claim: { content: "使用结构化账本", anchors: [] },
    reasoning: { status: "not_provided", steps: [] },
    evidence: [],
    concepts: [],
    reviewStatus: "human_confirmed",
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/cognition/audit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DeepSeek-Key": "test-key",
    },
    body: JSON.stringify(body),
  });
}

const REPORT: AssociationAuditReport = {
  results: [{
    nodeId: "node-1",
    relation: "RELATED",
    lexicalScore: 0.75,
    reason: "讨论同一认知沉淀方式。",
    quote: "使用结构化账本",
  }],
  truncated: false,
  candidateCountBeforeTruncation: 1,
  assessedCandidateCount: 1,
};

test("Next.js关联审计路由只公开合法的POST处理器", async () => {
  const route = await import(routeModulePath);

  assert.equal(typeof route.POST, "function");
  assert.equal("createCognitionAuditPost" in route, false);
});

test("合法凭证通过后返回报告且不采用浏览器传入的DeepSeek密钥", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  const verifiedNodes = [node("node-1")];
  const calls: Array<{ input: string; nodes: CognitionNodeV2[]; argumentCount: number }> = [];
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: true as const, nodes: verifiedNodes }),
    runAudit: async function (input: string, nodes: CognitionNodeV2[]) {
      calls.push({ input, nodes, argumentCount: arguments.length });
      return REPORT;
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "结构化账本如何沉淀认知",
    sources: [{ sourceId: "source-1" }],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...REPORT, auditScope: "full" });
  assert.deepEqual(calls, [{
    input: "结构化账本如何沉淀认知",
    nodes: verifiedNodes,
    argumentCount: 2,
  }]);
});

test("合法节点子集只进入本次审计并明确标记为subset", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  const verifiedNodes = [node("node-1"), node("node-2"), node("node-3")];
  const calls: CognitionNodeV2[][] = [];
  const subsetReport: AssociationAuditReport = {
    results: [{
      nodeId: "node-2",
      relation: "RELATED",
      lexicalScore: 0.68,
      reason: "限定节点与输入相关。",
      quote: "使用结构化账本",
    }],
    truncated: false,
    candidateCountBeforeTruncation: 1,
    assessedCandidateCount: 1,
  };
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: true as const, nodes: verifiedNodes }),
    runAudit: async (_input: string, nodes: CognitionNodeV2[]) => {
      calls.push(nodes);
      return subsetReport;
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "只重新检查第二个节点",
    sources: [{ sourceId: "source-1" }],
    candidateNodeIds: ["node-2"],
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[verifiedNodes[1]]]);
  assert.deepEqual(await response.json(), { ...subsetReport, auditScope: "subset" });
});

test("节点子集包含未验签编号时整次返回403且不运行审计", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  let auditCalls = 0;
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: true as const, nodes: [node("node-1")] }),
    runAudit: async () => {
      auditCalls += 1;
      return REPORT;
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "尝试混入其他IP节点",
    sources: [{ sourceId: "source-1" }],
    candidateNodeIds: ["node-1", "forged-node"],
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "认知来源凭证无效或已失效",
    code: "SECURITY_VALIDATION_FAILED",
  });
  assert.equal(auditCalls, 0);
});

test("限定子集的语义结果无效时仍整体失败且不返回部分报告", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: true as const, nodes: [node("node-1"), node("node-2")] }),
    runAudit: async (_input: string, nodes: CognitionNodeV2[]) => {
      assert.deepEqual(nodes.map(item => item.id), ["node-2"]);
      throw new Error("模型返回虚构节点或伪造引用");
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "只重新检查第二个节点",
    sources: [{ sourceId: "source-1" }],
    candidateNodeIds: ["node-2"],
  }));
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.deepEqual(body, {
    error: "关联审计失败，请重试",
    code: "ASSOCIATION_AUDIT_FAILED",
  });
  assert.equal("results" in body, false);
});

test("IP归属或最终凭证校验失败时返回403且不运行审计", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  let auditCalls = 0;
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: false as const }),
    runAudit: async () => {
      auditCalls += 1;
      return REPORT;
    },
  });

  const response = await POST(request({
    activeIPId: "ip-b",
    input: "结构化账本如何沉淀认知",
    sources: [{ sourceId: "source-owned-by-ip-a" }],
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "认知来源凭证无效或已失效",
    code: "SECURITY_VALIDATION_FAILED",
  });
  assert.equal(auditCalls, 0);
});

test("审计流水线报错时返回整体失败而不泄露部分报告", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  const POST = createCognitionAuditPost({
    verifySources: async () => ({ ok: true as const, nodes: [node("node-1")] }),
    runAudit: async () => {
      throw new Error("模型引用了虚构节点ID：invented-node");
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "结构化账本如何沉淀认知",
    sources: [{ sourceId: "source-1" }],
  }));
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.deepEqual(body, {
    error: "关联审计失败，请重试",
    code: "ASSOCIATION_AUDIT_FAILED",
  });
  assert.equal("results" in body, false);
});

test("凭证校验器内部异常时返回整体失败且不运行审计", async () => {
  const { createCognitionAuditPost } = await import(routeHandlerModulePath);
  let auditCalls = 0;
  const POST = createCognitionAuditPost({
    verifySources: async () => {
      throw new Error("ledger unavailable");
    },
    runAudit: async () => {
      auditCalls += 1;
      return REPORT;
    },
  });

  const response = await POST(request({
    activeIPId: "ip-a",
    input: "结构化账本如何沉淀认知",
    sources: [{ sourceId: "source-1" }],
  }));

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "关联审计失败，请重试",
    code: "ASSOCIATION_AUDIT_FAILED",
  });
  assert.equal(auditCalls, 0);
});
