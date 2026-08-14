import { NextResponse } from "next/server";
import {
  isLocalSyncEnabled,
  LOCAL_SYNC_MAX_BODY_BYTES,
  type LocalSyncPayload,
} from "./local-sync-contract";
import {
  LocalSyncCorruptionError,
  LocalSyncValidationError,
} from "./local-sync-manager";

type LocalSyncManagerLike = {
  read(): Promise<LocalSyncPayload>;
  update(data: Record<string, unknown>): Promise<LocalSyncPayload>;
};

type LocalSyncRouteOptions = {
  manager: LocalSyncManagerLike;
  isEnabled?: () => boolean;
  maxBodyBytes?: number;
};

class LocalSyncPayloadTooLargeError extends Error {}

function notFound() {
  return new Response(null, { status: 404 });
}

function payloadTooLarge() {
  return NextResponse.json({
    error: "本地同步数据超过10MB限制。",
    errorCode: "LOCAL_SYNC_PAYLOAD_TOO_LARGE",
  }, { status: 413 });
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
}

function isLoopbackRequest(request: Request) {
  try {
    if (!isLoopbackHostname(new URL(request.url).hostname)) return false;
    const host = request.headers.get("host");
    if (host && !isLoopbackHostname(new URL(`http://${host}`).hostname)) return false;
    const origin = request.headers.get("origin");
    return !origin || isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function parseIncomingData(bodyText: string): Record<string, unknown> | null {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

async function readBodyWithinLimit(request: Request, maxBodyBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new LocalSyncPayloadTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new LocalSyncPayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function storageErrorResponse(error: unknown) {
  if (error instanceof LocalSyncValidationError) {
    return NextResponse.json({
      error: "本地同步快照包含不支持的字段或数据类型。",
      errorCode: "LOCAL_SYNC_INVALID_SNAPSHOT",
    }, { status: 400 });
  }
  if (error instanceof LocalSyncCorruptionError) {
    return NextResponse.json({
      error: "本地同步主文件损坏，已停止写入，请先检查或恢复备份。",
      errorCode: "LOCAL_SYNC_FILE_CORRUPTED",
    }, { status: 409 });
  }
  return NextResponse.json({
    error: "本地同步暂时不可用。",
    errorCode: "LOCAL_SYNC_STORAGE_ERROR",
  }, { status: 500 });
}

export function createLocalSyncRouteHandlers(options: LocalSyncRouteOptions) {
  const enabled = options.isEnabled ?? isLocalSyncEnabled;
  const maxBodyBytes = options.maxBodyBytes ?? LOCAL_SYNC_MAX_BODY_BYTES;

  return {
    async GET(request: Request) {
      if (!enabled() || !isLoopbackRequest(request)) return notFound();
      try {
        return NextResponse.json(await options.manager.read());
      } catch (error) {
        return storageErrorResponse(error);
      }
    },

    async POST(request: Request) {
      if (!enabled() || !isLoopbackRequest(request)) return notFound();
      let bodyText: string;
      try {
        bodyText = await readBodyWithinLimit(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof LocalSyncPayloadTooLargeError) return payloadTooLarge();
        return storageErrorResponse(error);
      }
      const incoming = parseIncomingData(bodyText);
      if (!incoming) {
        return NextResponse.json({
          error: "本地同步请求格式无效。",
          errorCode: "LOCAL_SYNC_INVALID_REQUEST",
        }, { status: 400 });
      }
      try {
        const next = await options.manager.update(incoming);
        return NextResponse.json({ ok: true, updatedAt: next.updatedAt });
      } catch (error) {
        return storageErrorResponse(error);
      }
    },
  };
}
