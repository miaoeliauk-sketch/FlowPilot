import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDouyinLinks,
  getDouyinTranscriptionFailureMessage,
  validateDouyinTranscriptionRequest,
} from "./douyin-transcription";

test("从抖音分享文案中提取并去重视频链接", () => {
  const text = `3.21 复制打开抖音 https://v.douyin.com/abc123/ 看视频
https://www.douyin.com/video/1234567890
重复链接：https://v.douyin.com/abc123/。`;

  assert.deepEqual(extractDouyinLinks(text), [
    "https://v.douyin.com/abc123/",
    "https://www.douyin.com/video/1234567890",
  ]);
});

test("拒绝非抖音域名和伪装成抖音的域名", () => {
  const text = "https://example.com/page https://cdn.example.com/video.mp4?token=abc";
  assert.deepEqual(extractDouyinLinks(text), []);
  assert.deepEqual(extractDouyinLinks("https://douyin.com.evil.example/video/1"), []);
});

test("限制单批数量并校验转写密钥", () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => `https://www.douyin.com/video/${index}`).join("\n");
  assert.match(validateDouyinTranscriptionRequest({ linksText: tooMany, mode: "local" }) ?? "", /最多.*20条/);
  assert.match(validateDouyinTranscriptionRequest({ linksText: "https://v.douyin.com/a/", mode: "api" }) ?? "", /API Key/);
  assert.match(validateDouyinTranscriptionRequest({ linksText: "https://v.douyin.com/a/", mode: "bailian" }) ?? "", /DashScope API Key/);
  assert.equal(validateDouyinTranscriptionRequest({ linksText: "https://v.douyin.com/a/", mode: "local" }), null);
  assert.match(validateDouyinTranscriptionRequest({ linksText: "https://v.douyin.com/a/", mode: "local", cookiesFromBrowser: "unknown" }) ?? "", /浏览器/);
  assert.match(validateDouyinTranscriptionRequest({ linksText: "https://v.douyin.com/a/", mode: "api", apiKey: "key", apiBaseUrl: "file:///tmp/key" }) ?? "", /HTTP/);
  assert.match(validateDouyinTranscriptionRequest(null) ?? "", /请求内容不完整/);
});

test("未知失败状态使用固定安全提示而不展示接口原文", () => {
  assert.equal(
    getDouyinTranscriptionFailureMessage("unknown_failure", "接口原始提示"),
    "抖音链接处理失败，请稍后重试。",
  );
});
