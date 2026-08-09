import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";

const SAMPLE_STORAGE_KEY = "ipwr:topicCalibrationSamples";

function installBrowserEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/topic-board",
    pretendToBeVisual: true,
  });
  const browserGlobals: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(browserGlobals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  return () => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

test("未明确提供目标IP ID时拒绝导入且不写入样本", async () => {
  const restoreBrowser = installBrowserEnvironment();

  try {
    localStorage.clear();
    const { upsertShikongTopicCalibrationSamples } = await import("./topic-calibration-store");

    assert.throws(
      () => (upsertShikongTopicCalibrationSamples as (targetIPId?: string) => unknown)(),
      /必须明确提供目标IP ID/,
    );
    assert.equal(localStorage.getItem(SAMPLE_STORAGE_KEY), null);
  } finally {
    restoreBrowser();
  }
});

test("同名不同ID的IP只会绑定明确传入的目标ID", async () => {
  const restoreBrowser = installBrowserEnvironment();

  try {
    localStorage.clear();
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([
      { id: "ip-shikong-a", name: "设计师石空" },
      { id: "ip-shikong-b", name: "设计师石空" },
    ]));
    const {
      getTopicCalibrationSamples,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");

    const imported = upsertShikongTopicCalibrationSamples("ip-shikong-b");

    assert.equal(imported.ipId, "ip-shikong-b");
    assert.equal(imported.isOwnershipConfirmed, true);
    assert.equal(getTopicCalibrationSamples({ id: "ip-shikong-b" }).length, imported.total);
    assert.equal(getTopicCalibrationSamples({ id: "ip-shikong-a" }).length, 0);
  } finally {
    restoreBrowser();
  }
});

test("IP A和IP B依次导入后各自完整保留且互不覆盖", async () => {
  const restoreBrowser = installBrowserEnvironment();

  try {
    localStorage.clear();
    const {
      getTopicCalibrationSamples,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");

    upsertShikongTopicCalibrationSamples("ip-a");
    upsertShikongTopicCalibrationSamples("ip-b");

    const samplesA = getTopicCalibrationSamples({ id: "ip-a" });
    const samplesB = getTopicCalibrationSamples({ id: "ip-b" });
    const uniqueSampleIds = new Set([...samplesA, ...samplesB].map(sample => sample.id));

    assert.equal(samplesA.length, 14);
    assert.equal(samplesB.length, 14);
    assert.equal(uniqueSampleIds.size, 28);
  } finally {
    restoreBrowser();
  }
});

test("重新导入IP A后IP B的所有记录保持完全不变", async () => {
  const restoreBrowser = installBrowserEnvironment();

  try {
    localStorage.clear();
    const {
      getTopicCalibrationSamples,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");

    upsertShikongTopicCalibrationSamples("ip-a");
    upsertShikongTopicCalibrationSamples("ip-b");
    const samplesBBeforeReimport = getTopicCalibrationSamples({ id: "ip-b" });

    upsertShikongTopicCalibrationSamples("ip-a");
    const samplesBAfterReimport = getTopicCalibrationSamples({ id: "ip-b" });

    assert.deepEqual(samplesBAfterReimport, samplesBBeforeReimport);
  } finally {
    restoreBrowser();
  }
});

test("IP A已有完整样本时不会阻止Seeder为IP B导入", async () => {
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;

  try {
    localStorage.clear();
    const {
      getTopicCalibrationSamples,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");
    upsertShikongTopicCalibrationSamples("ip-a");

    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { TopicCalibrationSeeder } = await import("../components/TopicCalibrationSeeder");
    render(<TopicCalibrationSeeder targetIPId="ip-b" />);

    assert.equal(getTopicCalibrationSamples({ id: "ip-a" }).length, 14);
    assert.equal(getTopicCalibrationSamples({ id: "ip-b" }).length, 14);
  } finally {
    cleanupPage?.();
    restoreBrowser();
  }
});

test("Seeder未收到明确目标IP ID时不会自动导入", async () => {
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;

  try {
    localStorage.clear();
    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { TopicCalibrationSeeder } = await import("../components/TopicCalibrationSeeder");

    render(<TopicCalibrationSeeder />);

    assert.equal(localStorage.getItem(SAMPLE_STORAGE_KEY), null);
  } finally {
    cleanupPage?.();
    restoreBrowser();
  }
});

test("校准样本完整时，Seeder挂载不会重复写入", async () => {
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  let restoreSetItem: (() => void) | undefined;

  try {
    localStorage.setItem("ipwr:ips_v2", JSON.stringify([
      { id: "ip-shikong", name: "设计师石空" },
    ]));
    const {
      getTopicCalibrationImportStatus,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");
    const imported = upsertShikongTopicCalibrationSamples("ip-shikong");

    assert.equal(imported.isOwnershipConfirmed, true);
    assert.equal(imported.ipId, "ip-shikong");
    assert.ok(imported.total > 0);

    assert.deepEqual(getTopicCalibrationImportStatus("ip-shikong"), {
      total: imported.total,
      high: imported.high,
      medium: imported.medium,
      low: imported.low,
    });

    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const originalSetItem = storagePrototype.setItem;
    let calibrationWrites = 0;
    storagePrototype.setItem = function setItem(key: string, value: string) {
      if (key === SAMPLE_STORAGE_KEY) calibrationWrites += 1;
      return originalSetItem.call(this, key, value);
    };
    restoreSetItem = () => { storagePrototype.setItem = originalSetItem; };

    const { cleanup, render } = await import("@testing-library/react");
    cleanupPage = cleanup;
    const { TopicCalibrationSeeder } = await import("../components/TopicCalibrationSeeder");

    render(<TopicCalibrationSeeder targetIPId="ip-shikong" />);

    assert.equal(calibrationWrites, 0);
  } finally {
    cleanupPage?.();
    restoreSetItem?.();
    restoreBrowser();
  }
});
