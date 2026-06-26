import { NextRequest, NextResponse } from "next/server";

const HIFLY_BASE = "https://hfw-api.hifly.cc";

function getHiflyKey(req: NextRequest): string {
  return req.headers.get("X-Hifly-Key") || process.env.HIFLY_API_KEY || "";
}

export async function POST(req: NextRequest) {
  const key = getHiflyKey(req);
  if (!key) {
    return NextResponse.json({ error: "未配置 Hifly API Key，请在设置页填写" }, { status: 400 });
  }

  let body: {
    type: "video" | "image";
    title?: string;
    videoUrl?: string;
    imageUrl?: string;
    fileId?: string;
    model?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  if (!body.type || !["video", "image"].includes(body.type)) {
    return NextResponse.json({ error: "type 必须是 video 或 image" }, { status: 400 });
  }

  const endpoint = body.type === "video"
    ? `${HIFLY_BASE}/api/v2/hifly/avatar/create_by_video`
    : `${HIFLY_BASE}/api/v2/hifly/avatar/create_by_image`;

  const payload: Record<string, unknown> = {
    title: body.title || "未命名数字人",
  };

  if (body.type === "video") {
    if (!body.videoUrl && !body.fileId) {
      return NextResponse.json({ error: "视频数字人需要提供 videoUrl 或 fileId" }, { status: 400 });
    }
    if (body.videoUrl) payload.video_url = body.videoUrl;
    if (body.fileId) payload.file_id = body.fileId;
  } else {
    if (!body.imageUrl && !body.fileId) {
      return NextResponse.json({ error: "图片数字人需要提供 imageUrl 或 fileId" }, { status: 400 });
    }
    if (body.imageUrl) payload.image_url = body.imageUrl;
    if (body.fileId) payload.file_id = body.fileId;
    payload.model = body.model ?? 2;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.status === 401) {
      return NextResponse.json({ error: "Hifly API Key 无效或已过期" }, { status: 401 });
    }
    if (data.code !== 0) {
      return NextResponse.json({ error: `Hifly 错误：${data.message || "未知错误"}`, code: data.code }, { status: 400 });
    }

    return NextResponse.json({ taskId: data.task_id, requestId: data.request_id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "网络请求失败" }, { status: 500 });
  }
}

// 查询数字人任务状态
export async function GET(req: NextRequest) {
  const key = getHiflyKey(req);
  if (!key) {
    return NextResponse.json({ error: "未配置 Hifly API Key" }, { status: 400 });
  }

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "缺少 taskId 参数" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${HIFLY_BASE}/api/v2/hifly/avatar/task?task_id=${taskId}`,
      { headers: { "Authorization": `Bearer ${key}` } }
    );

    const data = await res.json();
    if (res.status === 401) {
      return NextResponse.json({ error: "Hifly API Key 无效或已过期" }, { status: 401 });
    }
    if (data.code !== 0) {
      return NextResponse.json({ error: `Hifly 错误：${data.message}`, code: data.code }, { status: 400 });
    }

    // status: 1=等待中 2=处理中 3=完成 4=失败
    const STATUS_MAP: Record<number, string> = { 1: "等待中", 2: "处理中", 3: "完成", 4: "失败" };
    return NextResponse.json({
      status: data.status,
      statusLabel: STATUS_MAP[data.status] ?? "未知",
      avatarId: data.avatar || null,
      requestId: data.request_id,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "网络请求失败" }, { status: 500 });
  }
}
