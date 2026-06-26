/**
 * POST /api/skill/classify
 *
 * FlowPilot 知识库分类引擎
 *
 * 输入任意文本内容，自动判断：
 * - type：case / method / hook / insight / persona
 * - scenes：idea / script / analysis / comment / review
 * - confidence：0~1
 * - reason：一句话解释
 *
 * 用途：
 * 1. 用户手动添加知识条目时，自动建议分类
 * 2. 批量导入时自动打标
 * 3. 知识库统一视图里的"重新分类"功能
 *
 * 规则（来自 Prompt 定义）：
 * - 不输出多个 type（每条内容只有一个主类型）
 * - 基于语义判断，不按关键词匹配
 * - 不允许把所有内容都归为 case
 */

import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek } from "@/lib/deepseek";
import { KnowledgeItemType, KnowledgeItemScene } from "@/lib/types";

// ── Prompt 定义（来自用户的分类引擎规范）──
const SYSTEM = `你是 FlowPilot 知识库分类引擎。

任务：根据输入内容，判断它属于哪一种知识类型。

类型定义：
- case：真实案例、爆款内容、数据表现
- method：方法论、步骤、模型、框架
- hook：开头、吸引注意、3秒钩子
- insight：评论区洞察、用户反馈、观点总结
- persona：IP人设、表达风格、语气语料

同时判断适用场景：
- idea（选题）
- script（脚本生成）
- analysis（分析）
- comment（评论理解）
- review（复盘）

规则：
1. 不允许输出多个 type，每条内容只有一个主类型
2. 必须基于语义判断，不能只看关键词
3. 不允许把所有内容都归为 case
4. scenes 可以是多个（一条知识可以适用于多个场景）
5. confidence 代表你对这个分类的把握程度（0~1），不确定时如实降低
6. 严格按 JSON 格式输出，不输出任何其他文字

输出格式：
{
  "type": "case|method|hook|insight|persona",
  "scenes": ["idea", "script", "analysis", "comment", "review"],
  "confidence": 0.0-1.0,
  "reason": "一句话解释为什么这样分类"
}`;

const PROMPT = (content: string, title?: string) => `请分类以下内容：

${title ? `标题：${title}\n` : ""}内容：
${content}`;

// 类型合法性校验
const VALID_TYPES: KnowledgeItemType[] = ["case", "method", "hook", "insight", "persona"];
const VALID_SCENES: KnowledgeItemScene[] = ["idea", "script", "analysis", "comment", "review"];

interface ClassifyResult {
  type: KnowledgeItemType;
  scenes: KnowledgeItemScene[];
  confidence: number;
  reason: string;
  // 附加：是否来自AI（方便区分人工分类和自动分类）
  source: "ai" | "fallback";
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";

  let body: {
    content: string;
    title?: string;
    /** 是否强制用AI（默认true），false时仅做规则判断 */
    useAI?: boolean;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const content = (body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "请提供要分类的内容" }, { status: 400 });
  }
  if (content.length > 3000) {
    return NextResponse.json({ error: "内容过长，请截取前3000字以内的核心部分" }, { status: 400 });
  }

  // 规则快速判断（无需AI）——用于批量场景或没有API Key时
  if (body.useAI === false || !apiKey) {
    const fallback = ruleBasedClassify(content, body.title);
    return NextResponse.json({ ...fallback, source: "fallback" });
  }

  // AI语义分类
  try {
    const raw = await callDeepSeek(SYSTEM, PROMPT(content, body.title), 300, 0.1, apiKey);

    // 解析JSON，清理 markdown 代码块
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI未返回有效JSON");

    const parsed: { type?: string; scenes?: string[]; confidence?: number; reason?: string } = JSON.parse(match[0]);

    // 校验 type 合法性
    const type = VALID_TYPES.includes(parsed.type as KnowledgeItemType)
      ? (parsed.type as KnowledgeItemType)
      : ruleBasedClassify(content, body.title).type;

    // 校验 scenes 合法性（过滤非法值）
    const scenes = (parsed.scenes ?? [])
      .filter((s): s is KnowledgeItemScene => VALID_SCENES.includes(s as KnowledgeItemScene));
    // scenes 不能为空
    const validScenes = scenes.length > 0 ? scenes : ruleBasedClassify(content, body.title).scenes;

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7;

    const result: ClassifyResult = {
      type,
      scenes: validScenes,
      confidence,
      reason: parsed.reason ?? "AI分类",
      source: "ai",
    };

    return NextResponse.json(result);
  } catch (err) {
    // AI失败时降级为规则判断
    const fallback = ruleBasedClassify(content, body.title);
    return NextResponse.json({
      ...fallback,
      source: "fallback",
      fallbackReason: err instanceof Error ? err.message : "AI分类失败",
    });
  }
}

/**
 * 规则快速判断（无AI，用于降级和批量场景）
 * 不如AI准确，但有兜底作用
 */
function ruleBasedClassify(
  content: string,
  title?: string,
): Omit<ClassifyResult, "source"> {
  const text = `${title ?? ""} ${content}`.toLowerCase();

  // hook：出现钩子相关关键词
  if (/开头|钩子|3秒|第一句|吸引|注意力|hook/i.test(text) && content.length < 200) {
    return { type: "hook", scenes: ["script"], confidence: 0.7, reason: "内容较短且包含钩子相关表述，判断为开头钩子" };
  }

  // persona：语气/风格/人设
  if (/语气|表达风格|口头禅|人设|禁用词|禁忌|我的风格|我的表达/i.test(text)) {
    return { type: "persona", scenes: ["script"], confidence: 0.75, reason: "包含语气/风格/人设相关描述" };
  }

  // insight：评论区/用户反馈
  if (/评论|反馈|用户说|粉丝说|观众问|有人问|吐槽|建议/i.test(text)) {
    return { type: "insight", scenes: ["idea", "comment"], confidence: 0.7, reason: "包含评论区或用户反馈内容" };
  }

  // method：方法论/步骤/框架
  if (/步骤|方法|框架|模型|公式|流程|如何|怎么|第一步|第二步/i.test(text)) {
    return { type: "method", scenes: ["idea", "script", "review"], confidence: 0.65, reason: "包含步骤/方法/框架等方法论特征" };
  }

  // case：数据/爆款/案例（默认，但不能全归为case）
  if (/播放量|点赞|万|数据|爆款|案例|效果|结果/i.test(text)) {
    return { type: "case", scenes: ["idea", "analysis"], confidence: 0.6, reason: "包含数据或案例相关表述" };
  }

  // 默认归为 method（避免全归 case）
  return { type: "method", scenes: ["idea"], confidence: 0.4, reason: "内容特征不明显，默认归为方法论，建议人工确认" };
}
