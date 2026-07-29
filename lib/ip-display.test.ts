import assert from "node:assert/strict";
import test from "node:test";
import { getIPDisplayLabel } from "./ip-display";

test("名称唯一时保持原显示名称", () => {
  const ips = [
    { id: "ip-only-a1b2c3", name: "唯一IP" },
    { id: "ip-other-d4e5f6", name: "另一个IP" },
  ];

  assert.equal(getIPDisplayLabel(ips[0], ips), "唯一IP");
});

test("同名IP显示不同的短ID后缀", () => {
  const ips = [
    { id: "ip-original-a1b2c3", name: "同名IP" },
    { id: "ip-newer-d4e5f6", name: "同名IP" },
  ];

  assert.equal(getIPDisplayLabel(ips[0], ips), "同名IP · #a1b2c3");
  assert.equal(getIPDisplayLabel(ips[1], ips), "同名IP · #d4e5f6");
});

test("同名IP的末6位相同时自动延长短ID", () => {
  const ips = [
    { id: "ip-original-xa1b2c3", name: "同名IP" },
    { id: "ip-newer-ya1b2c3", name: "同名IP" },
  ];

  assert.equal(getIPDisplayLabel(ips[0], ips), "同名IP · #xa1b2c3");
  assert.equal(getIPDisplayLabel(ips[1], ips), "同名IP · #ya1b2c3");
});
