/**
 * lib/api-settings.ts
 *
 * 客户端 API 配置管理。
 * DeepSeek API Key 只存在用户本地的 localStorage，
 * 不写入代码、不写入 .env 文件、不进入打包产物。
 * 每次调用 /api/* 时通过 X-DeepSeek-Key 请求头传递。
 */

const KEY_API_KEY = "ipwr:deepseekApiKey";

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY_API_KEY) ?? "";
}

export function setStoredApiKey(key: string): void {
  if (typeof window === "undefined") return;
  if (key.trim()) {
    localStorage.setItem(KEY_API_KEY, key.trim());
  } else {
    localStorage.removeItem(KEY_API_KEY);
  }
}

export function clearStoredApiKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY_API_KEY);
}

export function hasApiKey(): boolean {
  return !!getStoredApiKey();
}
