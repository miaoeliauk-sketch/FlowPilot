import assert from "node:assert/strict";
import test from "node:test";

import {
  assertIPSourceAnalysisProofConfiguration,
  buildIPSourceAnalysisProofClaims,
  createIPSourceAnalysisToken,
  verifyIPSourceAnalysisToken,
} from "./ip-source-analysis-proof";
import { buildIPSourceAnalysisV2 } from "./ip-source-analysis-v2";

const SECRET = "test-only-ip-source-analysis-proof-secret-32-bytes";

function analysis() {
  return buildIPSourceAnalysisV2({
    sourceId: "source-proof-test",
    sourceContent: "老师明确说：证据必须可以回到原文。",
    analyzedAt: "2026-08-24T18:00:00.000Z",
    createId: () => "00000000-0000-4000-8000-000000000091",
    candidate: {
      nodes: [{
        nodeRef: "N1",
        question: { content: "证据需要满足什么条件？", derivation: "inferred", anchors: [{ quote: "老师明确说：证据必须可以回到原文。" }] },
        claim: { content: "证据必须可以回到原文。", anchors: [{ quote: "证据必须可以回到原文" }] },
        reasoning: { status: "not_provided", steps: [] },
        evidence: [],
        concepts: [],
      }],
      aiSuggestions: { potentialPrinciples: [], topicPotential: [] },
    },
  });
}

test("解析凭证同时绑定IP、Source、AI原始节点和人工审核状态", () => {
  const original = analysis();
  const claims = buildIPSourceAnalysisProofClaims({ ipId: "ip-proof-test", analysis: original });
  const token = createIPSourceAnalysisToken(claims, SECRET);

  assert.equal(verifyIPSourceAnalysisToken(token, claims, SECRET), true);
  assert.equal(verifyIPSourceAnalysisToken(token, { ...claims, ipId: "ip-other" }, SECRET), false);
  const revised = structuredClone(original);
  revised.nodes[0]!.reviewStatus = "human_confirmed";
  assert.equal(verifyIPSourceAnalysisToken(
    token,
    buildIPSourceAnalysisProofClaims({ ipId: "ip-proof-test", analysis: revised }),
    SECRET,
  ), false);
});

test("非本地环境必须配置固定且足够长的认知解析凭证密钥", () => {
  assert.throws(
    () => assertIPSourceAnalysisProofConfiguration({ nodeEnv: "production", configuredSecret: undefined }),
    /必须配置固定密钥/,
  );
  assert.throws(
    () => assertIPSourceAnalysisProofConfiguration({ nodeEnv: "production", configuredSecret: "too-short" }),
    /长度不足/,
  );
  assert.doesNotThrow(() => assertIPSourceAnalysisProofConfiguration({
    nodeEnv: "production",
    configuredSecret: SECRET,
  }));
});
