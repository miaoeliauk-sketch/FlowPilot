import assert from "node:assert/strict";
import test from "node:test";

import {
  getKnowledgeHubCorrectionCategories,
  getKnowledgeHubAddAction,
  isKnowledgeHubCorrectionAllowed,
  KNOWLEDGE_HUB_LEGACY_SECTIONS,
  matchesKnowledgeHubSection,
} from "./knowledge-hub-view";

test("人工修正分类时不提供跨范围选项", () => {
  assert.deepEqual(getKnowledgeHubCorrectionCategories(null), [
    "定位方法库", "选题方法库", "标题方法库", "开头方法库", "文案框架方法库",
  ]);
  assert.deepEqual(getKnowledgeHubCorrectionCategories("ip-1"), [
    "IP人设资料", "IP表达语料", "IP历史内容", "IP高表现内容", "IP受众反馈", "IP禁用规则",
  ]);
  assert.deepEqual(getKnowledgeHubCorrectionCategories(""), []);
});

test("公共分类校验规则拒绝跨范围修正", () => {
  assert.equal(isKnowledgeHubCorrectionAllowed(null, "标题方法库"), true);
  assert.equal(isKnowledgeHubCorrectionAllowed(null, "IP表达语料"), false);
  assert.equal(isKnowledgeHubCorrectionAllowed("ip-a", "IP表达语料"), true);
  assert.equal(isKnowledgeHubCorrectionAllowed("ip-a", "标题方法库"), false);
  assert.equal(isKnowledgeHubCorrectionAllowed("", "标题方法库"), false);
  assert.equal(isKnowledgeHubCorrectionAllowed("", "IP表达语料"), false);
});

test("各知识区的新建入口分派到正确流程", () => {
  assert.equal(getKnowledgeHubAddAction("global"), "smart-intake");
  assert.equal(getKnowledgeHubAddAction("ip"), "smart-intake");
  assert.equal(getKnowledgeHubAddAction("viral"), "viral-form");
  assert.equal(getKnowledgeHubAddAction("hook"), "hook-form");
  assert.equal(getKnowledgeHubAddAction("voice"), "voice-form");
  assert.equal(getKnowledgeHubAddAction("material"), "cover-form");
});

test("原有三个专项知识库入口保持可见", () => {
  assert.deepEqual(KNOWLEDGE_HUB_LEGACY_SECTIONS, [
    { section: "viral", label: "爆款案例" },
    { section: "hook", label: "Hook库" },
    { section: "voice", label: "IP口播" },
  ]);
});

test("分类视图按范围、当前IP和新分类筛选", () => {
  const globalEntry = {
    category: "方法论",
    normalizedCategory: "定位方法库",
    ipId: null,
  };
  const activeIPEntry = {
    category: "IP语料库",
    normalizedCategory: "IP人设资料",
    ipId: "ip-active",
  };
  const viralEntry = {
    category: "爆款案例",
    normalizedCategory: "爆款案例",
    ipId: null,
  };

  assert.equal(matchesKnowledgeHubSection(globalEntry, {
    section: "global",
    selectedCategory: "定位方法库",
    activeIPId: "ip-active",
  }), true);
  assert.equal(matchesKnowledgeHubSection(globalEntry, {
    section: "global",
    selectedCategory: null,
    activeIPId: "ip-active",
  }), true);
  assert.equal(matchesKnowledgeHubSection({ ...globalEntry, ipId: "" }, {
    section: "global",
    selectedCategory: null,
    activeIPId: "ip-active",
  }), false);
  assert.equal(matchesKnowledgeHubSection(activeIPEntry, {
    section: "ip",
    selectedCategory: "IP人设资料",
    activeIPId: "ip-active",
  }), true);
  assert.equal(matchesKnowledgeHubSection(activeIPEntry, {
    section: "ip",
    selectedCategory: "IP人设资料",
    activeIPId: "ip-other",
  }), false);
  assert.equal(matchesKnowledgeHubSection(viralEntry, {
    section: "viral",
    selectedCategory: null,
    activeIPId: "ip-active",
  }), true);
});
