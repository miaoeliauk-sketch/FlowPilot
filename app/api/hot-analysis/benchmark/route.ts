import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

interface ComparableEntry { id: string; title: string; rawContent: string; hookPercentage: number | null; hookType: string | null; }
interface RequestBody { myContent?: string; comparables?: ComparableEntry[]; }

const SYSTEM = `你在做的是"我的内容 vs 知识库里的爆款案例"差距分析，目标是给出具体、可执行的差距点，不是泛泛而谈的鼓励或批评。

你拿到的对比案例都是真实存在于用户知识库里的内容，不是你编出来的，要基于这些案例的实际内容做比较。

输出"标题差距/钩子差距/案例差距/转化差距/信任感差距"这5项，每项都要点出：我的内容具体缺什么/对方具体有什么，给可操作的修改方向，不要写"可以再优化一下"这种空话。

严格按JSON格式输出，不要输出任何其他文字。`;

const PROMPT = (myContent: string, comparables: ComparableEntry[]) => `我的内容：
"""
${myContent}
"""

对标案例（来自知识库的真实爆款案例）：
${comparables.map((c, i) => `${i + 1}. 《${c.title}》钩子类型:${c.hookType ?? "未知"}\n内容：${c.rawContent.slice(0, 300)}`).join("\n\n")}

请严格按以下JSON格式输出：
{
  "titleGap": "标题差距，具体说我的标题和对标案例的标题结构差在哪",
  "hookGap": "钩子差距，具体说我的开头和对标案例的开头差在哪",
  "caseGap": "案例/论据差距，我是否像对标案例一样有具体案例/数字支撑",
  "conversionGap": "转化差距，我的结尾引导和对标案例的CTA设计差在哪",
  "trustGap": "信任感差距，对标案例是否有身份标签/数据支撑等建立信任的元素，我有没有"
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const myContent = (body.myContent ?? "").trim();
  const comparables = body.comparables ?? [];
  if (!myContent) {
    return NextResponse.json({ error: "请提供你的文案或逐字稿" }, { status: 400 });
  }
  if (comparables.length === 0) {
    return NextResponse.json({ error: "知识库里没有找到可对标的爆款案例，请先在知识库中心积累一些爆款案例", noComparables: true }, { status: 400 });
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    // 节奏差距：不用虚构的"秒数"，用Hook阶段占文本总长的比例——这个是真实可比的归一化指标，
    // 不同长度的文本也能公平比较。我的内容现场打标签算一遍，对标案例直接读已经存好的真实占比，取平均。
    const mySentences = splitSentences(myContent);
    const tagSystem = `给输入的句子逐句打标签，判断属于Hook/Problem/Solution/Case/CTA/none中的哪一个。严格输出JSON数组，不要输出其他文字。`;
    const tagPrompt = `句子列表：\n${mySentences.map((s, i) => `[${i}] ${s}`).join("\n")}\n\n按顺序为每句输出：[{"index":句子编号,"stage":"Hook|Problem|Solution|Case|CTA|none"}]`;
    const tagRaw = await callDeepSeek(tagSystem, tagPrompt, 1200, 0.3, apiKey);
    const tags = parseJSON<{ index: number; stage: string }[]>(tagRaw.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/)?.[0] ?? "[]", []);
    const totalChars = mySentences.reduce((sum, s) => sum + s.length, 0) || 1;
    const myHookChars = tags.filter(t => t.stage === "Hook").map(t => mySentences[t.index]).filter(Boolean).reduce((sum, s) => sum + s.length, 0);
    const myHookPercentage = Math.round((myHookChars / totalChars) * 100);

    const validComparableHooks = comparables.map(c => c.hookPercentage).filter((p): p is number => p != null);
    const avgComparableHookPercentage = validComparableHooks.length > 0
      ? Math.round(validComparableHooks.reduce((a, b) => a + b, 0) / validComparableHooks.length)
      : null;

    const raw = await callDeepSeek(SYSTEM, PROMPT(myContent, comparables), 1800, 0.3, apiKey);
    const parsed = parseJSON(raw, {
      titleGap: "", hookGap: "", caseGap: "", conversionGap: "", trustGap: "",
    });

    return NextResponse.json({
      titleGap: parsed.titleGap, hookGap: parsed.hookGap, caseGap: parsed.caseGap,
      conversionGap: parsed.conversionGap, trustGap: parsed.trustGap,
      rhythmGap: avgComparableHookPercentage != null ? {
        myHookPercentage, avgComparableHookPercentage,
        note: avgComparableHookPercentage > myHookPercentage
          ? `你的内容开头铺垫占比${myHookPercentage}%，对标案例平均${avgComparableHookPercentage}%，差距不大或你切入更快`
          : `你的内容开头铺垫占比${myHookPercentage}%，高于对标案例平均的${avgComparableHookPercentage}%，可能存在前期信息冗余、切入正题偏慢的风险`,
      } : { myHookPercentage, avgComparableHookPercentage: null, note: "对标案例缺少结构占比数据，无法给出节奏对比" },
      comparedCount: comparables.length,
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "对标分析失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
