import { NextRequest, NextResponse } from "next/server";
import type { IPProfile, IPStyleProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";
import { parseRequiredIPProfile } from "@/lib/ip-profile-validation";
import { parseIPStyleProfileForIP } from "@/lib/ip-style-profile-validation";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

/**
 * FlowPilot Content Engine Skill
 * 对应 SKILL.md：flowpilot-content-engine
 *
 * 按 SKILL.md 定义的工作流生成完整短视频内容包：
 * Step 1: IP定位确认
 * Step 2: 10条开头钩子（情感/对比/结果/权威 混合）
 * Step 3: 文案结构选择（4选1，说明选择理由）
 * Step 4: 完整脚本（6个模块）
 * Step 5: 20条标题 + 10条封面文案
 *
 * 核心原则（来自 SKILL.md）：
 * - Never output audience-free content（必须先定义受众）
 * - 钩子必须包含张力/冲突/好奇/情绪，禁止平铺直叙开头
 * - 结构选择要匹配受众和目标，不能只看话题
 * - 脚本语言要口语化，句子短，有具体案例
 */

interface RequestBody {
  topic: string;
  targetAudience?: string;
  contentGoal?: "traffic" | "conversion" | "persona";
  industry?: string;
  platform?: string;
  ipProfile?: IPProfile;
  styleProfile?: IPStyleProfile | null;
}

function firstNonEmptyString(
  values: Array<string | null | undefined>,
  fallback: string,
): string {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return fallback;
}

// ── 工作流系统提示词 ──
const SYSTEM = `你是 FlowPilot Content Engine，一个专门为短视频创作者生成完整内容包的AI。

你必须严格遵守以下原则（来自 SKILL.md）：

1. 永远不输出没有明确受众的内容（audience-free content）。如果受众不清晰，先定义一个具体受众，然后围绕这个受众生成。

2. 钩子必须有张力、冲突、好奇或情绪驱动。严禁"今天我来分享…"这类平铺直叙开头，除非完全改写后加入压力或利益点。

3. 文案结构选择要匹配受众和内容目标，不能只看话题本身：
   - 解决问题型（痛点→原因→方法→结果）：适合有明确痛点的受众
   - 认知颠覆型（常见认知→反转→证据→新行动）：适合需要突破固有认知的话题
   - 推荐型（处境→产品/服务逻辑→证据→决策建议）：适合转化目标
   - 现象分析型（观察→原因→后果→应对）：适合流量目标或建立权威

4. 脚本要口语化：短句，具体案例，清晰过渡。转化内容的CTA要具体但不强推。人设内容要展示态度和判断。流量内容的前3秒要有更强冲突。

5. 严格按JSON格式输出，不输出任何其他文字。`;

const PROMPT = (
  topic: string,
  audience: string,
  goal: string,
  industry: string,
  platform: string,
  ipBlock: string,
) => `${ipBlock}

---
【内容生产任务】
选题/关键词：${topic}
目标受众：${audience}
内容目标：${goal}（traffic=流量/转粉 | conversion=变现/转化 | persona=人设/建立信任）
行业/赛道：${industry}
目标平台：${platform}

请按以下 5 步生成完整内容包，严格按 JSON 格式输出：

{
  "step1_positioning": {
    "audienceDefinition": "具体的受众是谁（如果输入不清晰，给出最合理的假设并标注）",
    "audiencePainOrDesire": "这个受众的核心痛苦、欲望、恐惧或决策压力（具体，不要抽象）",
    "recommendedPersona": "建议用哪种人设说话：expert|peer|operator|buyer_guide|critic|mentor|case_sharer|service_provider",
    "trustAngle": "适合的信任角度：experience|result|method|case|data|insider_view",
    "positioningNote": "实战定位建议（一句话实用建议，不要品牌语言）"
  },

  "step2_hooks": [
    {
      "type": "emotional|contrast|result|authority",
      "hook": "完整的开头钩子文案（可以直接说出来的）",
      "tension": "这条钩子的张力点来自哪里（冲突/好奇/情绪/数据/颠覆认知）",
      "bestFor": "这条钩子最适合什么目标：traffic|conversion|persona"
    }
  ],

  "step3_structure": {
    "chosen": "problem_solving|conflict|recommendation|phenomenon",
    "reason": "选这个结构的理由（一句话，要提到为什么匹配这个受众和目标）",
    "outline": [
      { "block": "模块名", "content": "这个模块要说什么（具体，不是关键词）" }
    ]
  },

  "step4_script": {
    "opening": "完整的开头钩子段落（口语化，直接可用）",
    "scene": "场景铺垫（让受众感到真实、相关）",
    "corePoint": "核心观点（清晰、有冲击力、不要废话）",
    "method": "方法/步骤/建议（具体、可执行）",
    "case": "案例/数据/证据（真实感，来自IP的真实经历或典型案例）",
    "cta": "结尾CTA（匹配内容目标：traffic=互动引导，conversion=行动引导，persona=价值观表达）",
    "fullScript": "完整口播逐字稿（把上面6个模块串联成连贯的、可以直接朗读的脚本）"
  },

  "step5_titles_and_covers": {
    "titles": [
      { "title": "标题文本", "angle": "pain|result|warning|contrast|checklist|mistake|case|direct_benefit", "platform": "最适合的平台" }
    ],
    "coverCopy": [
      { "copy": "封面文案（短、冲击力强、手机上易读）", "style": "这条封面文案的风格特点" }
    ]
  }
}

要求：
- step2_hooks 必须生成 10 条，类型分布要包含：至少2条emotional、2条contrast、2条result、2条authority
- step5_titles_and_covers.titles 必须生成 20 条，angle 分布要覆盖所有 8 种
- step5_titles_and_covers.coverCopy 必须生成 10 条
- step4_script.fullScript 要完整可用，不要只写骨架`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const ipProfileResult = parseRequiredIPProfile(body.ipProfile);
  if (!ipProfileResult.ok) {
    return NextResponse.json({
      error: ipProfileResult.error,
      errorCode: ipProfileResult.errorCode,
      errorField: ipProfileResult.errorField,
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: null,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const ip = ipProfileResult.ipProfile;

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "请输入选题或关键词" }, { status: 400 });

  const styleProfileResult = parseIPStyleProfileForIP(body.styleProfile, ip.id);
  if (!styleProfileResult.ok) {
    return NextResponse.json({
      error: styleProfileResult.error,
      errorCode: styleProfileResult.errorCode,
      errorField: styleProfileResult.errorField,
      apiMeta: {
        apiCalled: false,
        calledAt: new Date().toISOString(),
        model: MODEL,
        ipUsed: ip.name,
        mockHit: false,
      },
    }, { status: 400 });
  }
  const styleProfile = styleProfileResult.styleProfile;
  const ipBlock = buildIPContextBlock(ip, styleProfile);

  // 受众优先级：请求体显式传入 > IP配置里的受众 > 待定义
  const audience = firstNonEmptyString(
    [body.targetAudience, ip.audience],
    "待AI根据话题定义",
  );
  const goal = body.contentGoal ?? "traffic";
  const industry = firstNonEmptyString(
    [body.industry, ip.contentDirection?.[0]],
    "待补充行业/赛道",
  );
  const platform = body.platform ?? ip.platforms?.[0] ?? "抖音";

  const calledAt = new Date().toISOString();

  try {
    const raw = await callDeepSeek(SYSTEM, PROMPT(topic, audience, goal, industry, platform, ipBlock), 4000, 0.3, apiKey);
    const parsed = parseJSON(raw, null as Record<string, unknown> | null);

    if (!parsed) {
      return NextResponse.json({ error: "内容生成失败，AI返回格式异常，请重试" }, { status: 500 });
    }

    // 验证10条钩子和20条标题是否齐全，不足时在日志里记录但不报错
    const hookCount = (parsed.step2_hooks as unknown[])?.length ?? 0;
    const titleCount = (parsed.step5_titles_and_covers as Record<string, unknown[]>)?.titles?.length ?? 0;
    const coverCount = (parsed.step5_titles_and_covers as Record<string, unknown[]>)?.coverCopy?.length ?? 0;

    return NextResponse.json({
      ...parsed,
      _meta: {
        topic, audience, goal, industry, platform,
        ipName: ip.name,
        hookCount, titleCount, coverCount,
        model: MODEL, calledAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
