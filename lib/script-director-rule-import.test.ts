import assert from "node:assert/strict";
import test from "node:test";

import { parseScriptDirectorRuleImportResponse } from "./script-director-rule-import";

const VALID_ANALYSIS = {
  targetAudience: ["希望用AI提高内容效率的创作者"],
  language: {
    catchphrases: [{
      id: "catchphrase-1",
      text: "明白吗？",
      level: "preference",
      enforcement: "prompt_only",
      scope: "body",
    }],
    forbiddenExpressions: [{
      id: "forbidden-1",
      text: "不能说‘大家有没有发现一个很有意思的现象’",
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "opening",
    }],
    toneGuidelines: [{
      id: "tone-1",
      text: "表达直接，但每个判断都要有推理",
      level: "quality_warning",
      enforcement: "model_review",
      scope: "body",
    }],
  },
  opening: {
    requirements: [{
      id: "opening-1",
      text: "先制造反差，再进入判断",
      level: "quality_warning",
      enforcement: "model_review",
      scope: "opening",
    }],
    forbiddenPatterns: [],
  },
  body: {
    reasoningSequence: [{
      id: "reasoning-1",
      text: "结论、案例、规律",
      level: "quality_warning",
      enforcement: "model_review",
      scope: "body",
    }],
    casePolicy: {
      maximumCasesPerClaim: 2,
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "body",
      requirements: [],
    },
    materialPolicies: [],
  },
  ending: {
    requirements: [{
      id: "ending-1",
      text: "回扣开头悬念",
      level: "quality_warning",
      enforcement: "model_review",
      scope: "ending",
    }],
    forbiddenPatterns: [],
  },
  examples: [{
    id: "example-title-1",
    kind: "title",
    content: "一个标题范例",
    demonstrates: "标题保留悬念",
    sourceReference: "用户导入规则文档",
    confirmationStatus: "unconfirmed",
    materialPermission: false,
    protectedEntities: [],
  }],
  compression: {
    enabled: true,
    targetReduction: {
      minimumPercent: 20,
      maximumPercent: 30,
      level: "quality_warning",
      enforcement: "deterministic",
      scope: "compression",
    },
    mustKeep: [],
    preferRemove: [],
    otherRequirements: [],
  },
  specialRules: [],
  validationRequirements: [],
};

test("AI解析结果按当前IP和原始文档构造可预览的草稿规则", () => {
  const rule = parseScriptDirectorRuleImportResponse(JSON.stringify(VALID_ANALYSIS), {
    ipId: "ip-pengpeng",
    ipName: "彭彭说AI",
    rawMarkdown: "# 彭彭说AI专属编导规则\n\n禁止空泛开头。",
    fileName: "彭彭说AI规则.md",
    importedAt: "2026-08-21T12:00:00.000Z",
    version: "1.0.0",
  });

  assert.equal(rule.ipId, "ip-pengpeng");
  assert.equal(rule.name, "彭彭说AI专属编导规则");
  assert.equal(rule.status, "draft");
  assert.equal(rule.source.rawMarkdown, "# 彭彭说AI专属编导规则\n\n禁止空泛开头。");
  assert.match(rule.source.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(rule.profileContext.usePlatformPositioningFromProfile, true);
  assert.equal(rule.body.casePolicy.level, "quality_warning");
  assert.equal(rule.body.casePolicy.enforcement, "deterministic");
  assert.equal(rule.compression.targetReduction?.scope, "compression");
  assert.equal(rule.examples[0]?.materialPermission, false);
});
