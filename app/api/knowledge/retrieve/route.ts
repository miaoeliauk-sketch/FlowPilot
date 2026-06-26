/**
 * GET /api/knowledge/retrieve?id=xxx&module=脚本工厂&context=xxx
 * POST /api/knowledge/retrieve  (批量)
 *
 * 统一知识条目检索接口（V2）
 * 获取单条或批量知识条目，同时记录AI引用
 */

import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeItemById, recordKnowledgeItemUsage, filterKnowledgeItems } from "@/lib/knowledge-adapter";
import { KnowledgeItemType, KnowledgeItemScene } from "@/lib/types";

// GET：按单个ID获取
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const module_ = req.nextUrl.searchParams.get("module") ?? "";
  const context = req.nextUrl.searchParams.get("context") ?? "";
  const recordUsage = req.nextUrl.searchParams.get("recordUsage") !== "false";

  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });

  const item = getKnowledgeItemById(id);
  if (!item) return NextResponse.json({ error: `未找到 id=${id} 的知识条目` }, { status: 404 });

  // 记录引用
  if (recordUsage && module_) {
    recordKnowledgeItemUsage(id, module_, context);
  }

  return NextResponse.json({ item });
}

// POST：批量检索 + 统计引用
export async function POST(req: NextRequest) {
  let body: {
    ids?: string[];              // 按ID批量获取
    types?: KnowledgeItemType[]; // 或按type批量获取
    scenes?: KnowledgeItemScene[];
    ipId?: string;
    limit?: number;
    module?: string;             // 哪个模块在调用（用于记录引用）
    context?: string;            // 调用上下文（用于记录引用）
    recordUsage?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  let items;

  if (body.ids?.length) {
    // 按ID批量获取
    items = body.ids.map(id => getKnowledgeItemById(id)).filter(Boolean);
  } else {
    // 按条件批量获取
    items = filterKnowledgeItems({
      types: body.types,
      scenes: body.scenes,
      ipId: body.ipId,
      limit: body.limit ?? 20,
    });
  }

  // 批量记录引用
  if (body.recordUsage !== false && body.module && items.length > 0) {
    for (const item of items) {
      if (item) recordKnowledgeItemUsage(item.id, body.module, body.context ?? "");
    }
  }

  return NextResponse.json({
    items: items.filter(Boolean),
    total: items.length,
    retrievedAt: new Date().toISOString(),
  });
}
