import { NextRequest, NextResponse } from "next/server";
import {
  createTeacherOriginalSourceSnapshot,
  ScriptSourceSnapshotError,
} from "@/lib/script-factory-source-snapshot-server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_REQUEST_FIELDS = new Set([
  "inputIntent",
  "confirmation",
  "ipId",
  "title",
  "rawContent",
  "idempotencyKey",
]);

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误", code: "INVALID_SOURCE_REQUEST" }, { status: 400 });
  }
  if (!isRecord(parsed)) {
    return NextResponse.json({ error: "请求格式错误", code: "INVALID_SOURCE_REQUEST" }, { status: 400 });
  }
  if (parsed.confirmation !== "TEACHER_ORIGINAL_CONFIRMED") {
    return NextResponse.json({
      error: "请先明确确认这是老师本人原文。",
      code: "TEACHER_ORIGINAL_CONFIRMATION_REQUIRED",
    }, { status: 400 });
  }
  if (Object.keys(parsed).some(key => !ALLOWED_REQUEST_FIELDS.has(key))) {
    return NextResponse.json({ error: "请求格式错误", code: "INVALID_SOURCE_REQUEST" }, { status: 400 });
  }
  if (
    parsed.inputIntent !== "teacher_original"
    || typeof parsed.ipId !== "string" || !parsed.ipId.trim()
    || parsed.ipId.trim().length > 128
    || typeof parsed.title !== "string" || !parsed.title.trim()
    || parsed.title.trim().length > 300
    || typeof parsed.rawContent !== "string" || !parsed.rawContent.trim()
    || parsed.rawContent.length > 160_000
    || typeof parsed.idempotencyKey !== "string" || !parsed.idempotencyKey.trim()
    || parsed.idempotencyKey.trim().length > 200
  ) {
    return NextResponse.json({ error: "请求格式错误", code: "INVALID_SOURCE_REQUEST" }, { status: 400 });
  }
  try {
    const source = await createTeacherOriginalSourceSnapshot({
      ipId: parsed.ipId.trim(),
      title: parsed.title.trim(),
      rawContent: parsed.rawContent,
      idempotencyKey: parsed.idempotencyKey.trim(),
    });
    return NextResponse.json({
      status: "created",
      sourceId: source.sourceId,
      ipId: source.ipId,
      contentSha256: source.contentSha256,
      provenance: source.provenance,
      createdAt: source.createdAt,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ScriptSourceSnapshotError) {
      if (error.code === "SOURCE_IDEMPOTENCY_CONFLICT") {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
    }
    return NextResponse.json({
      error: "老师原文保存失败，已停止生成。",
      code: "SOURCE_LEDGER_WRITE_FAILED",
    }, { status: 500 });
  }
}
