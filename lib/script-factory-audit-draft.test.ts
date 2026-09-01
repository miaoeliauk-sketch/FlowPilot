import assert from "node:assert/strict";
import test from "node:test";

import {
  getPendingScriptAuditDraft,
  promoteScriptAuditDraft,
  saveScriptAuditDraft,
} from "./script-factory-audit-draft";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  failNextWrite = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated storage failure");
    }
    this.values.set(key, value);
  }
}

test("正式写入后待审标记失败可安全重试且不会重复创建脚本", () => {
  const storage = new MemoryStorage();
  assert.equal(saveScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v1",
    result: { content: "待审正文" },
  }), true);
  const formalAssets = new Map<string, { id: string; auditSessionId: string; auditVersion: string }>();
  let createCalls = 0;
  const promote = () => promoteScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v1",
    findExistingAsset: () => formalAssets.get("audit-session-1") ?? null,
    createFormalAsset: () => {
      createCalls += 1;
      const asset = {
        id: "formal-script-1",
        auditSessionId: "audit-session-1",
        auditVersion: "audit-v1",
      };
      formalAssets.set("audit-session-1", asset);
      return asset.id;
    },
    verifyFormalAsset: assetId => {
      const asset = formalAssets.get("audit-session-1");
      return asset?.id === assetId
        && asset.auditSessionId === "audit-session-1"
        && asset.auditVersion === "audit-v1";
    },
  });

  storage.failNextWrite = true;
  assert.deepEqual(promote(), {
    ok: false,
    code: "COMMITTED_CLEANUP_PENDING",
    formalAssetId: "formal-script-1",
  });
  assert.ok(getPendingScriptAuditDraft(storage, "ip-1"));

  assert.deepEqual(promote(), {
    ok: true,
    code: "PROMOTED",
    formalAssetId: "formal-script-1",
  });
  assert.equal(createCalls, 1);
  assert.equal(getPendingScriptAuditDraft(storage, "ip-1"), null);
});

test("待审正文未成功保存时绝不创建正式脚本", () => {
  const storage = new MemoryStorage();
  let createCalls = 0;
  const result = promoteScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "missing-session",
    auditVersion: "audit-v1",
    findExistingAsset: () => null,
    createFormalAsset: () => {
      createCalls += 1;
      return "must-not-exist";
    },
    verifyFormalAsset: () => true,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "PENDING_DRAFT_NOT_FOUND",
  });
  assert.equal(createCalls, 0);
});

test("同一审计会话的待审版本与当前审计版本不一致时绝不创建正式脚本", () => {
  const storage = new MemoryStorage();
  assert.equal(saveScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v1",
    result: { content: "旧版本待审正文" },
  }), true);
  let createCalls = 0;

  const result = promoteScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v2",
    findExistingAsset: () => null,
    createFormalAsset: () => {
      createCalls += 1;
      return "must-not-exist";
    },
    verifyFormalAsset: () => true,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "PENDING_DRAFT_VERSION_MISMATCH",
  });
  assert.equal(createCalls, 0);
});

test("同一审计会话的旧版本正式稿不能被当前版本复用", () => {
  const storage = new MemoryStorage();
  assert.equal(saveScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v2",
    result: { content: "当前版本待审正文" },
  }), true);
  let createCalls = 0;

  const result = promoteScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v2",
    findExistingAsset: () => ({
      id: "formal-v1",
      auditSessionId: "audit-session-1",
      auditVersion: "audit-v1",
    }),
    createFormalAsset: () => {
      createCalls += 1;
      return "formal-v2";
    },
    verifyFormalAsset: assetId => assetId === "formal-v2",
  });

  assert.deepEqual(result, {
    ok: true,
    code: "PROMOTED",
    formalAssetId: "formal-v2",
  });
  assert.equal(createCalls, 1);
});

test("正式写入未通过回读验证时不返回可冒充成功的正式记录编号", () => {
  const storage = new MemoryStorage();
  assert.equal(saveScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v1",
    result: { content: "待审正文" },
  }), true);

  const result = promoteScriptAuditDraft(storage, {
    ipId: "ip-1",
    auditSessionId: "audit-session-1",
    auditVersion: "audit-v1",
    findExistingAsset: () => null,
    createFormalAsset: () => "unverified-formal-id",
    verifyFormalAsset: () => false,
  });

  assert.deepEqual(result, {
    ok: false,
    code: "FORMAL_WRITE_NOT_VERIFIED",
  });
  assert.equal("formalAssetId" in result, false);
});
