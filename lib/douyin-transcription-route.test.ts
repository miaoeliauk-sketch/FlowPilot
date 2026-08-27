import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/transcribe/douyin/route";

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("拒绝从非本机地址调用抖音转写", async () => {
  const response = await POST(request("https://flowpilot.example/api/transcribe/douyin", {
    linksText: "https://v.douyin.com/example/",
    mode: "local",
  }));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /只允许在本机使用/);
});

test("拒绝恶意网页跨站调用本机抖音转写", async () => {
  const response = await POST(new NextRequest("http://localhost/api/transcribe/douyin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
    },
    body: JSON.stringify({ linksText: "https://v.douyin.com/example/", mode: "local" }),
  }));
  assert.equal(response.status, 403);
});

test("无有效链接时在下载前返回明确提示", async () => {
  const response = await POST(request("http://localhost/api/transcribe/douyin", {
    linksText: "这里没有视频链接",
    mode: "local",
  }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.errorCode, "link_parse_failed");
  assert.match(body.error, /没有识别到抖音视频链接/);
});

test("请求体损坏时返回400且不启动下载", async () => {
  const response = await POST(new NextRequest("http://localhost/api/transcribe/douyin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-json",
  }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /不是有效的JSON/);
});
