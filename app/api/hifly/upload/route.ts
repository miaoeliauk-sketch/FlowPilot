import { NextRequest, NextResponse } from "next/server";

const HIFLY_BASE = "https://hfw-api.hifly.cc";

function getHiflyKey(req: NextRequest): string {
  // 优先读请求头（用户在设置页配置的Key），退回环境变量
  return req.headers.get("X-Hifly-Key") || process.env.HIFLY_API_KEY || "";
}

// Step1: 获取上传地址
export async function POST(req: NextRequest) {
  const key = getHiflyKey(req);
  if (!key) {
    return NextResponse.json({ error: "未配置 Hifly API Key，请在设置页填写" }, { status: 400 });
  }

  let body: { fileName?: string; fileType?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  if (!body.fileName || !body.fileType) {
    return NextResponse.json({ error: "缺少 fileName 或 fileType" }, { status: 400 });
  }

  try {
    const res = await fetch(`${HIFLY_BASE}/api/v2/hifly/file/upload_url`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_name: body.fileName, file_type: body.fileType }),
    });

    const data = await res.json();
    if (res.status === 401) {
      return NextResponse.json({ error: "Hifly API Key 无效或已过期" }, { status: 401 });
    }
    if (data.code !== 0) {
      return NextResponse.json({ error: `Hifly 错误：${data.message || "未知错误"}`, code: data.code }, { status: 400 });
    }

    return NextResponse.json({ uploadUrl: data.upload_url, fileId: data.file_id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "网络请求失败" }, { status: 500 });
  }
}
