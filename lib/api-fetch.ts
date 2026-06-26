/**
 * lib/api-fetch.ts
 *
 * 替代原生 fetch 用于调用项目内部 /api/* 接口。
 * 自动读取 localStorage 里存储的 DeepSeek API Key，
 * 以 X-DeepSeek-Key 请求头附加到每次请求中。
 * 服务端 API 路由从这个 header 读取 Key，不依赖 process.env。
 *
 * 用法：把所有 fetch("/api/xxx") 改为 apiFetch("/api/xxx")，其余参数不变。
 */

import { getStoredApiKey } from "./api-settings";

export async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const apiKey = getStoredApiKey();
  const headers = new Headers(init?.headers);

  if (apiKey) {
    headers.set("X-DeepSeek-Key", apiKey);
  }

  return fetch(url, { ...init, headers });
}
