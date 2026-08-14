import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVoiceStyleProfileForSave,
  getDefaultVoiceStyleSampleIds,
  parseVoiceStyleResponse,
  VoiceStyleParseError,
} from "./voice-style-profile";

const validProfile = {
  openingHabits: ["先抛判断", "用问题引入", "从场景切入"],
  viewpointStyle: "先给结论，再用生活场景解释原因。",
  sentenceLength: "长短句结合",
  emotionalTone: ["犀利", "克制"],
  commonPhrases: ["你有没有发现", "真正的问题是", "换句话说", "仔细想想", "所以"],
  closingHabits: ["回到行动", "用判断收束", "留下反问"],
  forbiddenExpressions: ["空洞口号", "过度书面语", "绝对化承诺"],
  styleSummary: "先用强判断抓住注意力，再通过具体场景推进，最后回到个人行动。",
};

test("parses a complete eight-field voice style profile", () => {
  assert.deepEqual(parseVoiceStyleResponse(JSON.stringify(validProfile)), validProfile);
});

test("rejects invalid JSON with a stable failure code", () => {
  assert.throws(
    () => parseVoiceStyleResponse("not-json"),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "INVALID_JSON",
  );
});

test("rejects a missing required field", () => {
  const { styleSummary: _styleSummary, ...missing } = validProfile;
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify(missing)),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "MISSING_FIELD",
  );
});

test("rejects incorrect field types", () => {
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify({ ...validProfile, emotionalTone: "犀利" })),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "INVALID_FIELD_TYPE",
  );
});

test("rejects arrays outside their allowed range", () => {
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify({ ...validProfile, commonPhrases: ["只有一个"] })),
    (error: unknown) => (
      error instanceof VoiceStyleParseError
      && error.diagnosticCode === "ARRAY_OUT_OF_RANGE"
      && error.diagnosticDetails.itemCount === 1
      && error.diagnosticDetails.fieldCount === undefined
    ),
  );
});

test("rejects unexpected ninth field in the strict response contract", () => {
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify({ ...validProfile, extraField: "不应接受" })),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "UNEXPECTED_FIELD",
  );
});

test("rejects unsupported sentence length values and empty strings", () => {
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify({ ...validProfile, sentenceLength: "超长句" })),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "INVALID_FIELD_VALUE",
  );
  assert.throws(
    () => parseVoiceStyleResponse(JSON.stringify({ ...validProfile, viewpointStyle: "   " })),
    (error: unknown) => error instanceof VoiceStyleParseError && error.diagnosticCode === "EMPTY_FIELD",
  );
});

test("frontend save guard rejects an empty or incomplete profile", () => {
  assert.equal(buildVoiceStyleProfileForSave({}, "ip-1"), null);
  assert.equal(buildVoiceStyleProfileForSave({ ...validProfile, styleSummary: "" }, "ip-1"), null);
  assert.equal(buildVoiceStyleProfileForSave(validProfile, "ip-1"), null);
});

test("frontend save guard accepts only a complete route response", () => {
  const profile = buildVoiceStyleProfileForSave({
    ...validProfile,
    sourceSampleIds: ["sample-1"],
    sourceSampleTitles: ["样本一"],
    extractedAt: "2026-08-06T00:00:00.000Z",
    model: "deepseek-v4-flash",
  }, "ip-1");

  assert.ok(profile);
  assert.equal(profile.ipId, "ip-1");
  assert.deepEqual(profile.openingHabits, validProfile.openingHabits);
});

test("default sample selection is capped at five items", () => {
  assert.deepEqual(
    getDefaultVoiceStyleSampleIds(
      Array.from({ length: 7 }, (_, index) => ({ id: `sample-${index + 1}` })),
    ),
    ["sample-1", "sample-2", "sample-3", "sample-4", "sample-5"],
  );
});
