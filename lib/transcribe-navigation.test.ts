import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("真实FlowPilot侧边栏提供逐字稿中心入口", () => {
  const layout = readFileSync(new URL("../components/layout/AppLayout.tsx", import.meta.url), "utf8");
  assert.match(layout, /label:\s*"逐字稿中心"/);
  assert.match(layout, /href:\s*"\/transcribe"/);
});

test("逐字稿页面包含抖音链接处理入口", () => {
  const page = readFileSync(new URL("../app/transcribe/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/transcribe/DouyinTranscribePanel.tsx", import.meta.url), "utf8");
  assert.match(page, /DouyinTranscribePanel/);
  assert.match(panel, /抖音链接转逐字稿/);
  assert.match(panel, /\/api\/transcribe\/douyin/);
});
