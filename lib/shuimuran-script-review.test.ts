import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShuimuranReviewPrompt,
  parseShuimuranReview,
} from "./shuimuran-script-review";

test("水木然生成后内容质量检查必须九项全部通过", () => {
  const result = parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: true,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: true,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
    },
    issues: [],
  }));

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("水木然生成后内容质量检查任一项失败时返回具体重写原因", () => {
  const result = parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: false,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: false,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
    },
    issues: ["标题直接公布了答案", "正文存在重复解释"],
  }));

  assert.equal(result.passed, false);
  assert.deepEqual(result.issues, ["标题直接公布了答案", "正文存在重复解释"]);
});

test("水木然生成后检查提示词只审查九项内容质量标准", () => {
  const prompt = buildShuimuranReviewPrompt({
    title: "胖东来的真正秘密，藏在《道德经》里",
    fullScript: "完整口播正文",
    pendingVerification: [],
    reviewedAt: "2026-08-14T12:00:00.000Z",
    sourceReferences: [
      {
        sourceTitle: "老师课程原文",
        kind: "claim",
        originalExcerpt: "真正重要的不是规模，而是人与人之间的信任。",
        extractionStatus: "人工确认",
      },
    ],
    caseEvidence: {
      title: "胖东来案例",
      content: "案例内容",
      verificationStatus: "人工已核实",
      sourceUrl: "https://example.com/source",
    },
  });

  assert.match(prompt, /观点是否属于水木然本人由生成后的独立归属审计判断/);
  assert.match(prompt, /事实核验由生成后的独立审计判断/);
  assert.doesNotMatch(prompt, /正文中的人物、时间、数据、热点和古籍原文/);
  assert.match(prompt, /开头是否在15秒内形成悬念/);
  assert.match(prompt, /过期热点是否已经转为长期认知内容/);
  assert.match(prompt, /老师课程原文/);
  assert.match(prompt, /真正重要的不是规模/);
  assert.match(prompt, /核实状态：人工已核实/);
  assert.match(prompt, /审查时间：2026-08-14T12:00:00.000Z/);
  assert.match(prompt, /没有明确发生时间时，不得把案例判断为24小时内热点/);
  assert.match(prompt, /不要改写文案/);
});

test("水木然终审不能同时声称九项全过又返回问题", () => {
  assert.throws(() => parseShuimuranReview(JSON.stringify({
    checks: {
      titleKeepsAnswer: true,
      openingBuildsSuspense: true,
      concreteEntry: true,
      classicExplainsReality: true,
      risesToPattern: true,
      conciseWithoutRepetition: true,
      staleHotspotReframed: true,
      titleOpeningEndingClosed: true,
      soundsLikeTeacher: true,
    },
    issues: ["仍有一处没有解决"],
  })), /自相矛盾/);
});
