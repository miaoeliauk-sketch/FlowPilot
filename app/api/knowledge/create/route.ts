/**
 * POST /api/knowledge/create
 *
 * 统一知识条目创建接口（V2）
 * 通过 adapter 层写入旧存储，保持向下兼容
 */

import { NextRequest, NextResponse } from "next/server";
import { createKnowledgeItem } from "@/lib/knowledge-adapter";
import { KnowledgeItemType, KnowledgeItemScene } from "@/lib/types";

interface RequestBody {
  type: KnowledgeItemType;
  scene: KnowledgeItemScene[];
  title: string;
  content: string;
  tags?: string[];
  keywords?: string[];
  ipId?: string | null;
  sourceTier?: "高" | "中" | "低";
  sourceTierReason?: string;
  legacyCategory?: string; // 可选：指定写入旧分类（默认由type自动映射）
  metrics?: { likes?: number; views?: number; comments?: number } | null;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  if (!body.type) return NextResponse.json({ error: "缺少 type 字段" }, { status: 400 });
  if (!body.title?.trim()) return NextResponse.json({ error: "缺少 title" }, { status: 400 });
  if (!body.content?.trim()) return NextResponse.json({ error: "缺少 content" }, { status: 400 });
  if (!body.scene?.length) return NextResponse.json({ error: "缺少 scene（至少一个）" }, { status: 400 });

  try {
    const item = createKnowledgeItem({
      type: body.type,
      scene: body.scene,
      title: body.title.trim(),
      content: body.content.trim(),
      tags: body.tags ?? [],
      keywords: body.keywords ?? [],
      ipId: body.ipId ?? null,
      sourceTier: body.sourceTier ?? "中",
      sourceTierReason: body.sourceTierReason ?? "用户手动添加",
      legacyCategory: body.legacyCategory ?? "",
      legacyId: "",
      metrics: body.metrics ?? null,
    });

    return NextResponse.json({ item, created: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "创建失败" }, { status: 500 });
  }
}
