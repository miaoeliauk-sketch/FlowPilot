import assert from "node:assert/strict";
import test from "node:test";
import type { IPProfile, IPStyleProfile } from "./types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private readonly writeFailureKeys = new Set<string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
    this.writeFailureKeys.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.writeFailureKeys.has(key)) throw new Error("模拟画像写入失败");
    this.values.set(key, value);
  }

  setWriteFailure(key: string, shouldFail: boolean) {
    if (shouldFail) this.writeFailureKeys.add(key);
    else this.writeFailureKeys.delete(key);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

const makeIP = (id: string, name: string, updatedAt: string): IPProfile => ({
  id,
  name,
  avatar: name.slice(0, 1),
  positioning: "",
  platforms: [],
  audience: "",
  contentDirection: [],
  personaKeywords: [],
  professionalIdentity: "",
  personalityTags: [],
  credibilitySource: "",
  representativeViewpoints: [],
  tone: "",
  commonOpenings: [],
  commonClosings: [],
  catchphrases: [],
  forbiddenExpressions: [],
  pacing: "",
  commonScenes: [],
  commonShotTypes: [],
  showsFace: true,
  usesScreenRecording: false,
  needsBroll: false,
  needsCaseScreenshots: false,
  needsSubtitleHighlight: false,
  sampleViralTitles: [],
  styleNotes: "",
  bio: "",
  color: "#000000",
  createdAt: updatedAt,
  updatedAt,
});

const sameNameIPs = () => [
  makeIP("ip-original-a1b2c3", "同名IP", "2026-07-28T00:00:00.000Z"),
  makeIP("ip-newer-d4e5f6", "同名IP", "2026-07-29T00:00:00.000Z"),
];

const styleProfile = (ipId: string): IPStyleProfile => ({
  ipId,
  openingHabits: ["先抛判断", "用问题引入", "从场景切入"],
  viewpointStyle: "先给结论，再解释原因。",
  sentenceLength: "长短句结合",
  emotionalTone: ["犀利", "克制"],
  commonPhrases: ["真正的问题是", "换句话说", "仔细想想", "所以", "你会发现"],
  closingHabits: ["回到行动", "用判断收束", "留下反问"],
  forbiddenExpressions: ["空洞口号", "过度书面语", "绝对化承诺"],
  styleSummary: "先用判断切入，再通过具体场景推进。",
  sourceSampleIds: ["sample-1"],
  sourceSampleTitles: ["样本一"],
  extractedAt: "2026-08-14T00:00:00.000Z",
  model: "deepseek-v4-flash",
});

const seed = (ips = sameNameIPs(), activeIPId: string | null = null) => {
  storage.clear();
  storage.setItem("ipwr:ips_v2", JSON.stringify(ips));
  storage.setItem("ipwr:activeIpId", JSON.stringify(activeIPId));
};

test("读取IP列表时不自动初始化或写入存储", async () => {
  const { getAllIPs } = await import("./ip-store");
  storage.clear();

  assert.deepEqual(getAllIPs(), []);
  assert.equal(storage.getItem("ipwr:ips_v2"), null);
});

test("全新环境只初始化一组固定ID的默认IP", async () => {
  const { initializeIPs } = await import("./ip-store");
  storage.clear();

  const initialized = initializeIPs();

  assert.deepEqual(initialized.map(ip => ip.id), [
    "demo-ip-pengpeng-ai-v1",
    "demo-ip-weiyu-v1",
  ]);
  assert.equal(
    JSON.parse(storage.getItem("ipwr:defaultIPsInitialized:v1") ?? "false"),
    true,
  );
});

test("已有恢复数据时不生成默认IP并补初始化标记", async () => {
  const { initializeIPs } = await import("./ip-store");
  const restored = [makeIP("restored-ip", "已恢复IP", "2026-07-29T00:00:00.000Z")];
  storage.clear();
  storage.setItem("ipwr:ips_v2", JSON.stringify(restored));

  const initialized = initializeIPs();

  assert.deepEqual(initialized.map(ip => ip.id), ["restored-ip"]);
  assert.equal(
    JSON.parse(storage.getItem("ipwr:defaultIPsInitialized:v1") ?? "false"),
    true,
  );
});

test("重复初始化仍然只有两个固定ID", async () => {
  const { initializeIPs } = await import("./ip-store");
  storage.clear();

  initializeIPs();
  const initializedAgain = initializeIPs();

  assert.deepEqual(initializedAgain.map(ip => ip.id), [
    "demo-ip-pengpeng-ai-v1",
    "demo-ip-weiyu-v1",
  ]);
  const saved = JSON.parse(storage.getItem("ipwr:ips_v2") ?? "[]") as IPProfile[];
  assert.equal(saved.length, 2);
});

test("IP列表被明确清空后不重新生成默认IP", async () => {
  const { initializeIPs } = await import("./ip-store");
  storage.clear();
  storage.setItem("ipwr:ips_v2", "[]");

  assert.deepEqual(initializeIPs(), []);
  assert.equal(
    JSON.parse(storage.getItem("ipwr:defaultIPsInitialized:v1") ?? "false"),
    true,
  );
});

test("已有初始化标记但IP存储键缺失时不重新生成默认IP", async () => {
  const { initializeIPs } = await import("./ip-store");
  storage.clear();
  storage.setItem("ipwr:defaultIPsInitialized:v1", "true");

  assert.deepEqual(initializeIPs(), []);
  assert.equal(storage.getItem("ipwr:ips_v2"), null);
});

test("IP列表为空时不会尝试激活不存在的IP", async () => {
  const { getOrInitActiveIP } = await import("./ip-store");
  storage.clear();
  storage.setItem("ipwr:ips_v2", "[]");
  storage.setItem("ipwr:defaultIPsInitialized:v1", "true");

  assert.equal(getOrInitActiveIP(), null);
  assert.equal(storage.getItem("ipwr:activeIpId"), null);
});

test("读取时保留全部同名IP", async () => {
  const { getAllIPs } = await import("./ip-store");
  seed();

  assert.deepEqual(getAllIPs().map(ip => ip.id), [
    "ip-original-a1b2c3",
    "ip-newer-d4e5f6",
  ]);
});

test("旧IP没有专属编导规则字段时保持兼容且按未启用处理", async () => {
  const { getAllIPs } = await import("./ip-store");
  seed([makeIP("legacy-ip", "旧IP", "2026-07-28T00:00:00.000Z")]);

  assert.equal(getAllIPs()[0]?.scriptDirectorProfileId, undefined);
});

test("创建同名IP时不删除已有记录", async () => {
  const { createIP } = await import("./ip-store");
  seed();
  const { id: _id, color: _color, createdAt: _createdAt, updatedAt: _updatedAt, ...input } =
    makeIP("unused", "同名IP", "2026-07-29T00:00:00.000Z");

  createIP(input);

  const saved = JSON.parse(storage.getItem("ipwr:ips_v2") ?? "[]") as IPProfile[];
  assert.equal(saved.length, 3);
  assert.deepEqual(saved.slice(0, 2).map(ip => ip.id), [
    "ip-original-a1b2c3",
    "ip-newer-d4e5f6",
  ]);
});

test("修改同名IP时只更新目标记录", async () => {
  const { updateIP } = await import("./ip-store");
  seed();

  updateIP("ip-original-a1b2c3", { audience: "已修改" });

  const saved = JSON.parse(storage.getItem("ipwr:ips_v2") ?? "[]") as IPProfile[];
  assert.equal(saved.length, 2);
  assert.equal(saved.find(ip => ip.id === "ip-original-a1b2c3")?.audience, "已修改");
  assert.equal(saved.find(ip => ip.id === "ip-newer-d4e5f6")?.audience, "");
});

test("删除同名IP时只删除目标记录", async () => {
  const { deleteIP } = await import("./ip-store");
  seed();

  deleteIP("ip-newer-d4e5f6");

  const saved = JSON.parse(storage.getItem("ipwr:ips_v2") ?? "[]") as IPProfile[];
  assert.deepEqual(saved.map(ip => ip.id), ["ip-original-a1b2c3"]);
});

test("激活其中一个同名IP时仍展示其他同名记录", async () => {
  const { getAllIPs } = await import("./ip-store");
  seed(sameNameIPs(), "ip-original-a1b2c3");

  assert.equal(getAllIPs().length, 2);
});

test("语气画像写入失败时明确报错且不伪装保存成功", async () => {
  const { saveStyleProfile } = await import("./ip-store");
  storage.clear();
  storage.setWriteFailure("ipwr:ipStyleProfiles", true);

  assert.throws(
    () => saveStyleProfile(styleProfile("ip-a")),
    /语气画像保存失败/,
  );
  assert.equal(storage.getItem("ipwr:ipStyleProfiles"), null);
});

test("脚本审计和人工处理记录只有在历史记录真实写入后才返回成功", async () => {
  const { updateScriptAssetResult } = await import("./ip-store");
  storage.clear();
  storage.setItem("ipwr:scriptAssets", JSON.stringify([{
    id: "script-1",
    ipId: "ip-1",
    content: "旧正文",
    scriptResult: { auditVersion: "old" },
  }]));

  assert.equal(updateScriptAssetResult("script-1", "ip-1", { auditVersion: "new" }, "新正文"), true);
  storage.setWriteFailure("ipwr:scriptAssets", true);
  assert.equal(updateScriptAssetResult("script-1", "ip-1", { auditVersion: "not-saved" }), false);
  storage.setWriteFailure("ipwr:scriptAssets", false);

  const saved = JSON.parse(storage.getItem("ipwr:scriptAssets") ?? "[]") as Array<{ content: string; scriptResult: { auditVersion: string } }>;
  assert.equal(saved[0]?.scriptResult.auditVersion, "new");
  assert.equal(saved[0]?.content, "新正文");
});

test("损坏的旧语气画像数据不会被当成空数组覆盖", async () => {
  const { saveStyleProfile } = await import("./ip-store");
  storage.clear();
  const corrupted = "{not-valid-json";
  storage.setItem("ipwr:ipStyleProfiles", corrupted);

  assert.throws(
    () => saveStyleProfile(styleProfile("ip-a")),
    /语气画像数据已损坏/,
  );
  assert.equal(storage.getItem("ipwr:ipStyleProfiles"), corrupted);
});

test("结构残缺的旧语气画像也会明确报错并保留原数据", async () => {
  const { saveStyleProfile } = await import("./ip-store");
  storage.clear();
  const structurallyCorrupted = JSON.stringify([null]);
  storage.setItem("ipwr:ipStyleProfiles", structurallyCorrupted);

  assert.throws(
    () => saveStyleProfile(styleProfile("ip-a")),
    /语气画像数据已损坏/,
  );
  assert.equal(storage.getItem("ipwr:ipStyleProfiles"), structurallyCorrupted);
});
