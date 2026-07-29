import assert from "node:assert/strict";
import test from "node:test";
import type { IPProfile } from "./types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
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
    this.values.set(key, value);
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

const seed = (ips = sameNameIPs(), activeIPId: string | null = null) => {
  storage.clear();
  storage.setItem("ipwr:ips_v2", JSON.stringify(ips));
  storage.setItem("ipwr:activeIpId", JSON.stringify(activeIPId));
};

test("读取时保留全部同名IP", async () => {
  const { getAllIPs } = await import("./ip-store");
  seed();

  assert.deepEqual(getAllIPs().map(ip => ip.id), [
    "ip-original-a1b2c3",
    "ip-newer-d4e5f6",
  ]);
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
