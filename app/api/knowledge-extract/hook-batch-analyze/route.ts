import { NextRequest, NextResponse } from "next/server";

import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";


const MAX_BATCH_SIZE = 150;

interface HookItem { id: string; hookText: string; track: string; }
interface RequestBody { items?: HookItem[]; }

const HOOK_TYPES = "痛点型/反常识型/数据型/故事型/收益型/身份型/冲突型/情绪型";

const BATCH_SYSTEM = `你在做的是Hook知识库的批量轻量分类，不是深度评估——这一批可能有上百条，你的任务只有两件事：
1. 给每条钩子归类到这8种类型之一：${HOOK_TYPES}
2. 复核一下用户标的"赛道"是否合理，给出你认为更准确的赛道（可以和原标签一样，也可以不一样，如果原标签就是对的，直接原样返回）

不要做钩子评分、不要点评好坏、不要写任何分析性的长文字，只给分类结果，保持轻量——这一层的设计目标是数量优先，不是分析深度。

严格按JSON数组格式输出，数组里每一项对应一条输入，顺序和数量必须和输入完全一致，不能跳过任何一条，也不能合并多条成一条。`;

const BATCH_PROMPT = (items: HookItem[]) => `请给以下每条钩子分类，按输入顺序原样返回，不要跳过：

${items.map((it, i) => `${i + 1}. [id:${it.id}] 原赛道:${it.track || "未填"} | 钩子原文:${it.hookText}`).join("\n")}

严格按以下JSON数组格式输出，数组长度必须等于${items.length}：
[
  {"id": "原样带回输入里的id", "hookType": "${HOOK_TYPES}（八选一）", "trackConfirmed": "复核后的赛道"}
]`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const items = body.items ?? [];
  if (items.length === 0) {
    return NextResponse.json({ error: "没有待分析的条目" }, { status: 400 });
  }
  if (items.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `单次最多处理${MAX_BATCH_SIZE}条，请分批提交（这次提交了${items.length}条）` }, { status: 400 });
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    // token预算：每条钩子很短，但要留出返回数组的空间，按条目数动态给上限，避免长批次被截断
    const maxTokens = Math.min(8000, 400 + items.length * 40);
    const raw = await callDeepSeek(BATCH_SYSTEM, BATCH_PROMPT(items), maxTokens, 0.3, apiKey);
    const parsed = parseJSON<{ id: string; hookType: string; trackConfirmed: string }[]>(raw, []);

    // 只返回AI真正给出结果的条目，没返回的（比如被截断漏掉的）由前端检测缺口、单独重试，不在这里补假数据
    const validHookTypes = new Set(HOOK_TYPES.split("/"));
    const results = parsed
      .filter((r) => r.id && validHookTypes.has(r.hookType))
      .map((r) => ({ id: r.id, hookType: r.hookType, trackConfirmed: r.trackConfirmed || "" }));

    return NextResponse.json({
      results,
      requestedCount: items.length,
      returnedCount: results.length,
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "批量分析失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
