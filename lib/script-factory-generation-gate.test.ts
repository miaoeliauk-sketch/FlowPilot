import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/script-factory/route";
import type { IPProfile } from "./types";

const IP: IPProfile = {
  id: "ip-1", name: "测试IP", avatar: "测", positioning: "商业观察",
  platforms: ["视频号"], audience: "创业者", contentDirection: ["商业"],
  personaKeywords: [], professionalIdentity: "作者", personalityTags: [], credibilitySource: "公开写作",
  representativeViewpoints: [], tone: "克制", commonOpenings: [], commonClosings: [], catchphrases: [],
  forbiddenExpressions: [], pacing: "递进", commonScenes: [], commonShotTypes: [], showsFace: true,
  usesScreenRecording: false, needsBroll: false, needsCaseScreenshots: false, needsSubtitleHighlight: false,
  sampleViralTitles: [], styleNotes: "", bio: "", color: "#000000", createdAt: "2026-01-01", updatedAt: "2026-01-01",
};

test("NONE没有明确确认探索稿边界时在调用模型前被阻断", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}");
  };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip",
        ipProfile: IP,
        topic: "测试选题",
        evidenceGate: { coverage: "NONE", limitationsAcknowledged: false },
      }),
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /探索稿|老师立场/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PARTIAL即使确认风险也必须保留老师的claim原文引用", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "PARTIAL",
          limitationsAcknowledged: true,
          coveredDimensions: ["核心判断"],
          missingDimensions: ["推理过程"],
          caseNeed: "NOT_ASSESSED",
          sourceReferences: [{
            sourceId: "s1", sourceTitle: "原文", itemId: "r1", kind: "reasoning",
            content: "推理", originalExcerpt: "推理", extractionStatus: "人工确认",
          }],
        },
      }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /核心判断/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("PARTIAL保留claim并确认风险后可以进入待审核稿生成", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "PARTIAL",
          limitationsAcknowledged: true,
          coveredDimensions: ["核心判断"],
          missingDimensions: ["推理过程"],
          caseNeed: "NOT_ASSESSED",
          sourceReferences: [{
            sourceId: "s1", sourceTitle: "原文", itemId: "c1", kind: "claim",
            content: "观点", originalExcerpt: "老师明确表达过的观点", extractionStatus: "人工确认",
          }],
        },
      }),
    }));
    assert.notEqual(response.status, 400);
    assert.equal(called, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("NONE确认不代表老师立场后可以进入探索稿生成", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "NONE",
          limitationsAcknowledged: true,
          coveredDimensions: [],
          missingDimensions: ["核心判断", "推理过程"],
          caseNeed: "NOT_ASSESSED",
          sourceReferences: [],
        },
      }),
    }));
    assert.notEqual(response.status, 400);
    assert.equal(called, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("IP专属生成显式选择后不能绕过观点覆盖度", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ generationMode: "ip", ipProfile: IP, topic: "测试选题" }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /观点覆盖度/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("未知生成模式会在调用模型前被拒绝", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({ generationMode: "unknown", ipProfile: IP, topic: "测试选题" }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /生成模式无效/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("充分覆盖缺少观点或推理原文引用时也不能绕过", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "FULL", evidenceConfirmed: true, caseNeed: "NOT_NEEDED", caseDecision: "skip",
          sourceReferences: [{ sourceId: "s1", sourceTitle: "原文", itemId: "c1", kind: "claim", content: "观点", originalExcerpt: "观点", extractionStatus: "人工确认" }],
        },
      }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /观点和推理/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("案例为必需但案例内容为空时不能生成", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "FULL", evidenceConfirmed: true, caseNeed: "REQUIRED", caseDecision: "manual",
          sourceReferences: [
            { sourceId: "s1", sourceTitle: "原文", itemId: "c1", kind: "claim", content: "观点", originalExcerpt: "观点", extractionStatus: "人工确认" },
            { sourceId: "s1", sourceTitle: "原文", itemId: "r1", kind: "reasoning", content: "推理", originalExcerpt: "推理", extractionStatus: "人工确认" },
          ],
          caseEvidence: { title: "空案例", content: "", sourceType: "用户提供", verificationStatus: "未经系统核验" },
        },
      }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /案例内容/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("案例可增强时没有做选择也不能生成", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip", ipProfile: IP, topic: "测试选题",
        evidenceGate: {
          coverage: "FULL", evidenceConfirmed: true, caseNeed: "ENHANCEMENT",
          sourceReferences: [
            { sourceId: "s1", sourceTitle: "原文", itemId: "c1", kind: "claim", content: "观点", originalExcerpt: "观点", extractionStatus: "人工确认" },
            { sourceId: "s1", sourceTitle: "原文", itemId: "r1", kind: "reasoning", content: "推理", originalExcerpt: "推理", extractionStatus: "人工确认" },
          ],
        },
      }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /选择使用案例/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("水木然专属规则阻止未经核验的案例进入正式口播稿", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}"); };
  try {
    const response = await POST(new NextRequest("http://localhost/api/script-factory", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DeepSeek-Key": "test-key" },
      body: JSON.stringify({
        generationMode: "ip",
        ipProfile: { ...IP, name: "水木然", scriptDirectorProfileId: "shuimuran-v1" },
        topic: "测试选题",
        evidenceGate: {
          coverage: "FULL", evidenceConfirmed: true, caseNeed: "REQUIRED", caseDecision: "manual",
          sourceReferences: [
            { sourceId: "s1", sourceTitle: "原文", itemId: "c1", kind: "claim", content: "观点", originalExcerpt: "观点", extractionStatus: "人工确认" },
            { sourceId: "s1", sourceTitle: "原文", itemId: "r1", kind: "reasoning", content: "推理", originalExcerpt: "推理", extractionStatus: "人工确认" },
          ],
          caseEvidence: { title: "待核验案例", content: "一条未经核验的网络说法", sourceType: "用户提供", verificationStatus: "未经系统核验" },
        },
      }),
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /不允许把待核验案例写入正式口播稿/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});
