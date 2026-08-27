import { NextRequest, NextResponse } from "next/server";

const HIFLY_BASE = "https://hfw-api.hifly.cc";

function getHiflyKey(req: NextRequest): string {
  return req.headers.get("X-Hifly-Key") || process.env.HIFLY_API_KEY || "";
}

// 创建视频生成任务（文本驱动）
export async function POST(req: NextRequest) {
  const key = getHiflyKey(req);
  if (!key) {
    return NextResponse.json({ error: "未配置 Hifly API Key，请在设置页填写" }, { status: 400 });
  }

  let body: {
    avatarId: string;
    voiceId: string;
    script: string;
    title?: string;
    resolution?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  if (!body.avatarId) return NextResponse.json({ error: "缺少数字人 avatarId" }, { status: 400 });
  if (!body.voiceId) return NextResponse.json({ error: "缺少声音 voiceId" }, { status: 400 });
  if (!body.script?.trim()) return NextResponse.json({ error: "请输入脚本文案" }, { status: 400 });
  if (body.script.length > 3000) {
    return NextResponse.json({ error: "脚本文案不能超过3000字" }, { status: 400 });
  }

  const payload = {
    title: body.title || "Nicole生成视频",
    avatar: body.avatarId,
    voice: body.voiceId,
    content: body.script,
    resolution: body.resolution || "1080p",
  };

  try {
    const res = await fetch(`${HIFLY_BASE}/api/v2/hifly/creation/text_driven`, {
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
      return NextResponse.json({ error: `视频生成失败：${data.message || "未知错误"}`, code: data.code }, { status: 400 });
    }

    return NextResponse.json({ taskId: data.task_id, requestId: data.request_id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "网络请求失败" }, { status: 500 });
  }
}

// 查询视频生成任务状态
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
      `${HIFLY_BASE}/api/v2/hifly/creation/task?task_id=${taskId}`,
      { headers: { "Authorization": `Bearer ${key}` } }
    );

    const data = await res.json();
    if (res.status === 401) {
      return NextResponse.json({ error: "Hifly API Key 无效或已过期" }, { status: 401 });
    }
    if (data.code !== 0) {
      return NextResponse.json({ error: `查询失败：${data.message}`, code: data.code }, { status: 400 });
    }

    // status: 1=等待中 2=处理中 3=完成 4=失败
    const STATUS_MAP: Record<number, string> = { 1: "等待中", 2: "处理中", 3: "完成", 4: "失败" };
    return NextResponse.json({
      status: data.status,
      statusLabel: STATUS_MAP[data.status] ?? "未知",
      videoUrl: data.video_url || null,
      coverUrl: data.cover_url || null,
      duration: data.duration || null,
      requestId: data.request_id,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "网络请求失败" }, { status: 500 });
  }
}
