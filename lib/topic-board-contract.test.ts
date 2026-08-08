import assert from "node:assert/strict";
import test from "node:test";
import { parseTopicBoardResult, TopicBoardContractError } from "./topic-board-contract";
import { createValidTopicBoardResult } from "./topic-board-contract.fixture";

test("解析完整的选题董事会结果契约", () => {
  const input = createValidTopicBoardResult();
  const result = parseTopicBoardResult(input);

  assert.equal(result.contractVersion, 1);
  assert.equal(result.ipId, "ip-shuimuran");
  assert.equal(result.dataEvidence.calibration.dominant, "high");
  assert.equal(result.experts[0].role, "用户需求专家");
});

test("拒绝缺少字段、字段类型错误和旧版本结果", () => {
  const missingIP = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  delete missingIP.ipId;
  assert.throws(
    () => parseTopicBoardResult(missingIP),
    (error: unknown) => error instanceof TopicBoardContractError
      && error.code === "MISSING_FIELD"
      && error.field === "ipId",
  );

  const wrongExpertType = createValidTopicBoardResult();
  (wrongExpertType.experts[0] as unknown as Record<string, unknown>).finalScore = "69";
  assert.throws(
    () => parseTopicBoardResult(wrongExpertType),
    (error: unknown) => error instanceof TopicBoardContractError
      && error.code === "INVALID_FIELD"
      && error.field === "experts[0].finalScore",
  );

  const oldVersion = createValidTopicBoardResult() as unknown as Record<string, unknown>;
  oldVersion.contractVersion = 0;
  assert.throws(
    () => parseTopicBoardResult(oldVersion),
    (error: unknown) => error instanceof TopicBoardContractError
      && error.code === "UNSUPPORTED_VERSION"
      && error.field === "contractVersion",
  );
});

test("拒绝把数组或对象转换成合法的校准主导类型", () => {
  for (const invalidDominant of [["high"], { value: "high" }]) {
    const input = createValidTopicBoardResult();
    (input.dataEvidence.calibration as unknown as Record<string, unknown>).dominant = invalidDominant;

    assert.throws(
      () => parseTopicBoardResult(input),
      (error: unknown) => error instanceof TopicBoardContractError
        && error.code === "INVALID_FIELD"
        && error.field === "dataEvidence.calibration.dominant",
    );
  }
});
