import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScriptDirectorRuleProofConfiguration,
  createScriptDirectorRuleActivationProof,
  createScriptDirectorRuleTestProof,
  verifyScriptDirectorRuleActivationProof,
  verifyScriptDirectorRuleTestProof,
} from "./script-director-rule-proof";

const SECRET = "test-only-script-director-proof-secret-32-bytes";
const CLAIMS = {
  ipId: "ip-pengpeng",
  ruleId: "director-rule:ip-pengpeng:1.0.0:abc",
  contentHash: "a".repeat(64),
  testType: "familiar" as const,
};

test("服务端签发的测试凭证只能用于同一IP、规则正文和测试类型", () => {
  const proof = createScriptDirectorRuleTestProof(CLAIMS, SECRET);

  assert.equal(verifyScriptDirectorRuleTestProof(proof, CLAIMS, SECRET), true);
  assert.equal(verifyScriptDirectorRuleTestProof(proof, { ...CLAIMS, ipId: "ip-other" }, SECRET), false);
  assert.equal(verifyScriptDirectorRuleTestProof(proof, { ...CLAIMS, contentHash: "b".repeat(64) }, SECRET), false);
  assert.equal(verifyScriptDirectorRuleTestProof(proof, { ...CLAIMS, testType: "stress" }, SECRET), false);
});

test("前端自行拼接或篡改的测试凭证不能通过服务端核验", () => {
  const proof = createScriptDirectorRuleTestProof(CLAIMS, SECRET);
  const [payload] = proof.split(".");

  assert.equal(verifyScriptDirectorRuleTestProof(`${payload}.forged-signature`, CLAIMS, SECRET), false);
  assert.equal(verifyScriptDirectorRuleTestProof("not-a-proof", CLAIMS, SECRET), false);
});

test("启用凭证绑定具体IP、规则和正文，不能由测试凭证冒充", () => {
  const activationClaims = {
    ipId: CLAIMS.ipId,
    ruleId: CLAIMS.ruleId,
    contentHash: CLAIMS.contentHash,
    activationId: "activation-current",
  };
  const activationProof = createScriptDirectorRuleActivationProof(activationClaims, SECRET);
  const testProof = createScriptDirectorRuleTestProof(CLAIMS, SECRET);

  assert.equal(verifyScriptDirectorRuleActivationProof(activationProof, activationClaims, SECRET), true);
  assert.equal(verifyScriptDirectorRuleActivationProof(testProof, activationClaims, SECRET), false);
  assert.equal(verifyScriptDirectorRuleActivationProof(
    activationProof,
    { ...activationClaims, ruleId: "director-rule:other" },
    SECRET,
  ), false);
  assert.equal(verifyScriptDirectorRuleActivationProof(
    activationProof,
    { ...activationClaims, activationId: "activation-revoked" },
    SECRET,
  ), false);
});

test("非本地环境必须配置固定且足够长的凭证密钥", () => {
  assert.throws(
    () => assertScriptDirectorRuleProofConfiguration({ nodeEnv: "production", configuredSecret: undefined }),
    /必须配置固定密钥/,
  );
  assert.throws(
    () => assertScriptDirectorRuleProofConfiguration({ nodeEnv: "production", configuredSecret: "too-short" }),
    /长度不足/,
  );
  assert.doesNotThrow(() => assertScriptDirectorRuleProofConfiguration({
    nodeEnv: "production",
    configuredSecret: SECRET,
  }));
  assert.doesNotThrow(() => assertScriptDirectorRuleProofConfiguration({
    nodeEnv: "development",
    configuredSecret: undefined,
  }));
});
