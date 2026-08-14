import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContentShares } from "./copy-integration-weights";

test("极大但有限的权重仍能稳定归一化", () => {
  const shares = normalizeContentShares([
    { id: "source-1", name: "文案1", content: "一", contentWeight: Number.MAX_VALUE },
    { id: "source-2", name: "文案2", content: "二", contentWeight: Number.MAX_VALUE },
  ]);

  assert.deepEqual(shares.map(item => item.sharePercent), [50, 50]);
});
