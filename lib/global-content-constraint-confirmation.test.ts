import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT,
  confirmGlobalBlockingConstraintFromKnowledge,
} from "./global-content-constraint-confirmation";
import { GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY } from "./global-content-constraint-store";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("没有服务端正规确认流程时即使字段全部正确也必须拒绝", async () => {
  const storage = new MemoryStorage();
  const canonicalText = [
    "判断对象是表达动机，不是具体词汇。",
    "允许反差、悬念和适度焦虑。",
    "禁止利用受众的无力感进行情绪操纵，迫使其被动接受或行动。",
  ].join("\n");
  storage.setItem("ipwr:knowledgeEntries", JSON.stringify([{
    id: "legacy-emotional-coercion-card",
    title: "禁止利用无力感进行情绪绑架",
    category: "通用禁用规则",
    ipId: null,
    rawContent: canonicalText,
  }]));

  await assert.rejects(
    confirmGlobalBlockingConstraintFromKnowledge(storage, {
      sourceKnowledgeEntryId: "legacy-emotional-coercion-card",
      expectedSourceTitle: "禁止利用无力感进行情绪绑架",
      expectedSourceRawContent: canonicalText,
      confirmedBy: "彭彭",
      confirmationStatement: GLOBAL_BLOCKING_CONSTRAINT_CONFIRMATION_STATEMENT,
      rule: {
        title: "禁止利用无力感进行情绪绑架",
        canonicalText,
        prohibitedIntent: "利用受众无力感进行情绪操纵",
        allowedBoundaries: ["引用", "批判", "合理语境"],
        detectionTerms: ["被时代抛弃", "阶级固化"],
      },
    }),
    /浏览器本地确认入口已停用|必须通过服务端一次性挑战/,
  );

  assert.equal(storage.getItem(GLOBAL_BLOCKING_CONSTRAINT_STORAGE_KEY), null);
});
