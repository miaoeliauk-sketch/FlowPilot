import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalSyncEnabled,
  LOCAL_SYNC_MAX_BODY_BYTES,
} from "./local-sync-contract";

test("本地同步只在开发环境显式开启时启用", () => {
  assert.equal(LOCAL_SYNC_MAX_BODY_BYTES, 10 * 1024 * 1024);
  assert.equal(isLocalSyncEnabled({
    NODE_ENV: "production",
    ENABLE_LOCAL_SYNC: "true",
  }), false);
  assert.equal(isLocalSyncEnabled({
    NODE_ENV: "development",
    ENABLE_LOCAL_SYNC: "false",
  }), false);
  assert.equal(isLocalSyncEnabled({
    NODE_ENV: "development",
    ENABLE_LOCAL_SYNC: "true",
  }), true);
});
