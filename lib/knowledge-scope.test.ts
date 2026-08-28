import assert from "node:assert/strict";
import test from "node:test";
import {
  filterKnowledgeVisibleToIP,
  isKnowledgeVisibleToIP,
} from "./knowledge-scope";

test("通用知识对所有IP可见，没有当前IP时也可见", () => {
  const globalKnowledge = { id: "global-1", category: "通用禁用规则", ipId: null };

  assert.equal(isKnowledgeVisibleToIP(globalKnowledge, "ip-a"), true);
  assert.equal(isKnowledgeVisibleToIP(globalKnowledge, null), true);
});

test("私有知识只对所属IP可见，没有当前IP时不可见", () => {
  const privateKnowledge = { id: "private-a", category: "IP禁用规则", ipId: "ip-a" };

  assert.equal(isKnowledgeVisibleToIP(privateKnowledge, "ip-a"), true);
  assert.equal(isKnowledgeVisibleToIP(privateKnowledge, "ip-b"), false);
  assert.equal(isKnowledgeVisibleToIP(privateKnowledge, null), false);
});

test("归属字段缺失、类型错误或空白时默认不可见", () => {
  assert.equal(isKnowledgeVisibleToIP({ ipId: undefined }, "ip-a"), false);
  assert.equal(isKnowledgeVisibleToIP({ ipId: 0 }, "ip-a"), false);
  assert.equal(isKnowledgeVisibleToIP({ ipId: "" }, ""), false);
  assert.equal(isKnowledgeVisibleToIP({ ipId: "   " }, "   "), false);
});

test("批量过滤只保留通用知识和当前IP知识，并保持原顺序", () => {
  const items = [
    { id: "global-1", ipId: null },
    { id: "private-b", ipId: "ip-b" },
    { id: "private-a", ipId: "ip-a" },
    { id: "broken", ipId: undefined },
    { id: "global-2", ipId: null },
  ];

  assert.deepEqual(
    filterKnowledgeVisibleToIP(items, "ip-a").map(item => item.id),
    ["global-1", "private-a", "global-2"],
  );
});
