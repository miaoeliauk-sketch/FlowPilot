import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

const SYSTEM = `你是逐字稿整理专家。任务是对用户提供的原始口语转写文本做三件事：

1. 清洗版：去除口头禅（嗯、啊、那个、就是、然后等）、明显的重复句子、无意义的停顿词，但不能改变任何原始信息、观点、案例——只清理语言噪音，不改变内容。

2. 分段版：把清洗版按语义和话题自然分段，每段加一个简短的小标题（用【】括起来），方便阅读。

3. 摘要：提炼以下四项——
   - 核心主题（一句话）
   - 关键观点（3-5条，每条一句话）
   - 重点案例（如果有的话，列出1-3个）
   - 可复用金句（原文里有传播价值的表达，原样摘录，不要改写）

必须严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (raw: string) => `原始逐字稿：
"""
${raw}
"""

请严格按以下JSON格式输出：
{
  "cleaned": "清洗后的逐字稿，去除口头禅和重复，不改变内容",
  "segmented": "分段版逐字稿，每段有【小标题】",
  "summary": {
    "theme": "核心主题（一句话）",
    "keyPoints": ["关键观点1", "关键观点2", "关键观点3"],
    "cases": ["案例1（如果有的话）"],
    "quotables": ["可复用金句1（原文原话）", "可复用金句2"]
  }
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: { rawText?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const rawText = (body.rawText ?? "").trim();
  if (!rawText) {
    return NextResponse.json({ error: "请提供逐字稿文本" }, { status: 400 });
  }
  if (rawText.length < 50) {
    return NextResponse.json({ error: "逐字稿内容太短，请至少提供50个字" }, { status: 400 });
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL };

  try {
    const raw = await callDeepSeek(SYSTEM, PROMPT(rawText), 4000, 0.3, apiKey);
    const parsed = parseJSON<{ cleaned: string; segmented: string; summary: { theme: string; keyPoints: string[]; cases: string[]; quotables: string[] } }>(raw, {
      cleaned: "", segmented: "", summary: { theme: "", keyPoints: [], cases: [], quotables: [] },
    });
    return NextResponse.json({ ...parsed, apiMeta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "整理失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
