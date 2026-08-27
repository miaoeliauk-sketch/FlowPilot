export type DouyinTranscriptionMode = "local" | "api" | "bailian";
export type DouyinTranscriptionFailureCode =
  | "link_parse_failed"
  | "cookie_required"
  | "download_failed"
  | "audio_conversion_failed"
  | "transcription_failed";

const FAILURE_MESSAGES: Record<DouyinTranscriptionFailureCode, string> = {
  link_parse_failed: "没有识别到抖音视频链接，请检查分享文案或链接后重试。",
  cookie_required: "该视频需要登录信息才能下载，请选择Chrome、Safari等浏览器登录信息后重试。",
  download_failed: "视频下载失败，请检查网络或稍后重试。",
  audio_conversion_failed: "视频已下载，但音频转换失败，请检查本机FFmpeg后重试。",
  transcription_failed: "音频已下载，但转写失败，请检查所选转写方式或稍后重试。",
};

export const DOUYIN_TRANSCRIPTION_SAFE_ERROR_MESSAGE = "抖音链接处理失败，请稍后重试。";

export function getDouyinTranscriptionFailureMessage(
  errorCode: string | undefined,
  fallback: string,
): string {
  if (!errorCode) return fallback;
  return Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, errorCode)
    ? FAILURE_MESSAGES[errorCode as DouyinTranscriptionFailureCode]
    : DOUYIN_TRANSCRIPTION_SAFE_ERROR_MESSAGE;
}

export interface DouyinTranscriptionRequest {
  linksText: string;
  mode: DouyinTranscriptionMode;
  modelSize?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  apiModel?: string;
  dashscopeApiKey?: string;
  cookiesFromBrowser?: string;
}

export interface DouyinTranscriptResult {
  sourceUrl: string;
  videoId?: string;
  title: string;
  status: "success" | "error";
  text: string;
  errorCode?: DouyinTranscriptionFailureCode;
  message?: string;
}

export interface DouyinHealth {
  ready: boolean;
  toolDir: string;
  missing: string[];
  modes: Record<DouyinTranscriptionMode, boolean>;
}

const URL_PATTERN = /https?:\/\/[^\s]+/g;
const TRAILING_PUNCTUATION = /[，。！？、；：'"”’】》〉」』.,;:!?)]+$/;
const DOUYIN_HOST_PATTERN = /(^|\.)douyin\.com$/i;
const MODEL_SIZES = new Set(["tiny", "base", "small", "medium", "large"]);
const COOKIE_BROWSERS = new Set(["", "chrome", "edge", "safari", "firefox"]);

export function extractDouyinLinks(text: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const rawUrl of text.match(URL_PATTERN) ?? []) {
    const url = rawUrl.replace(TRAILING_PUNCTUATION, "");
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!DOUYIN_HOST_PATTERN.test(hostname)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

export function validateDouyinTranscriptionRequest(
  request: Partial<DouyinTranscriptionRequest> | null | undefined,
): string | null {
  if (!request || typeof request.linksText !== "string" || typeof request.mode !== "string") {
    return "请求内容不完整，请重新填写后再试。";
  }
  const optionalTextFields = [
    request.modelSize,
    request.apiKey,
    request.apiBaseUrl,
    request.apiModel,
    request.dashscopeApiKey,
    request.cookiesFromBrowser,
  ];
  if (optionalTextFields.some(value => value !== undefined && typeof value !== "string")) {
    return "请求内容格式不正确，请重新填写后再试。";
  }
  if (request.linksText.length > 50_000) return "粘贴内容过长，请只保留需要处理的视频链接。";
  const links = extractDouyinLinks(request.linksText || "");
  if (links.length === 0) return "没有识别到抖音视频链接，可以直接粘贴抖音分享文案。";
  if (links.length > 20) return "为避免误操作，一次最多处理20条链接。";
  if (!(["local", "api", "bailian"] as string[]).includes(request.mode)) return "不支持这种转写方式。";
  if (request.modelSize && !MODEL_SIZES.has(request.modelSize)) return "不支持这个本地模型。";
  if (!COOKIE_BROWSERS.has(request.cookiesFromBrowser ?? "")) return "不支持读取这个浏览器的登录信息。";
  if ((request.apiKey?.length ?? 0) > 10_000 || (request.dashscopeApiKey?.length ?? 0) > 10_000) return "API Key内容过长。";
  if ((request.apiModel?.length ?? 0) > 100) return "模型名称过长。";
  if ((request.apiBaseUrl?.length ?? 0) > 2_048) return "接口地址过长。";
  if (request.apiBaseUrl) {
    try {
      const protocol = new URL(request.apiBaseUrl).protocol;
      if (protocol !== "http:" && protocol !== "https:") return "接口地址只支持HTTP或HTTPS。";
    } catch {
      return "接口地址格式不正确。";
    }
  }
  if (request.mode === "api" && !request.apiKey?.trim()) return "请填写在线接口的API Key。";
  if (request.mode === "bailian" && !request.dashscopeApiKey?.trim()) return "请填写DashScope API Key。";
  return null;
}
