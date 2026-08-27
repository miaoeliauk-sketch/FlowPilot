import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  validateDouyinTranscriptionRequest,
  type DouyinTranscriptionRequest,
} from "@/lib/douyin-transcription";

export const runtime = "nodejs";
export const maxDuration = 1800;

const BRIDGE_PATH = path.join(process.cwd(), "scripts", "flowpilot_douyin_bridge.py");
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "PYTHONIOENCODING",
  "FLOWPILOT_DOUYIN_TOOL_DIR",
  "NODE_ENV",
] as const;

function isTrustedLocalRequest(request: NextRequest): boolean {
  if (!LOCAL_HOSTNAMES.has(request.nextUrl.hostname)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    return LOCAL_HOSTNAMES.has(parsedOrigin.hostname)
      && parsedOrigin.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function childEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    CHILD_ENV_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key]]] : []),
  ) as NodeJS.ProcessEnv;
}

function runBridge(input: string | null, health = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [BRIDGE_PATH, ...(health ? ["--health"] : [])], {
      env: childEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let outputExceeded = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("处理超时，请减少链接数量后重试。"));
    }, 30 * 60 * 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_SIZE) {
        outputExceeded = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.resume();
    child.on("error", error => {
      clearTimeout(timeout);
      reject(new Error("本机逐字稿处理程序无法启动。", { cause: error }));
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (outputExceeded) {
        reject(new Error("处理结果过大，请减少链接数量后重试。"));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || "{}") as { error?: string };
        if (code !== 0 || parsed.error) reject(new Error("本机逐字稿工具处理失败，请检查工具安装和链接后重试。"));
        else resolve(parsed);
      } catch {
        reject(new Error("本机处理程序返回了无法识别的结果。"));
      }
    });
    child.stdin.end(input ?? undefined);
  });
}

export async function GET(request: NextRequest) {
  if (!isTrustedLocalRequest(request)) {
    return NextResponse.json({ error: "抖音转写只允许在本机使用。" }, { status: 403 });
  }
  try {
    return NextResponse.json(await runBridge(null, true));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法检查本机环境。" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedLocalRequest(request)) {
    return NextResponse.json({ error: "抖音转写只允许在本机使用。" }, { status: 403 });
  }
  let payload: DouyinTranscriptionRequest;
  try {
    payload = await request.json() as DouyinTranscriptionRequest;
  } catch {
    return NextResponse.json({ error: "请求内容不是有效的JSON。" }, { status: 400 });
  }
  const validationError = validateDouyinTranscriptionRequest(payload);
  if (validationError) {
    return NextResponse.json({
      error: validationError,
      ...(validationError.startsWith("没有识别到抖音视频链接")
        ? { errorCode: "link_parse_failed" }
        : {}),
    }, { status: 400 });
  }
  try {
    return NextResponse.json(await runBridge(JSON.stringify(payload)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "抖音链接处理失败。" }, { status: 500 });
  }
}
