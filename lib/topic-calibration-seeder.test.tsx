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

test("校准样本完整时，Seeder挂载不会重复写入", async () => {
  const restoreBrowser = installBrowserEnvironment();
  let cleanupPage: (() => void) | undefined;
  let restoreSetItem: (() => void) | undefined;

  try {
    const {
      getTopicCalibrationImportStatus,
      upsertShikongTopicCalibrationSamples,
    } = await import("./topic-calibration-store");
    const imported = upsertShikongTopicCalibrationSamples();

    assert.deepEqual(getTopicCalibrationImportStatus(), {
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

    render(<TopicCalibrationSeeder />);

    assert.equal(calibrationWrites, 0);
  } finally {
    cleanupPage?.();
    restoreSetItem?.();
    restoreBrowser();
  }
});
