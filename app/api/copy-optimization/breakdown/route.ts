import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseDeepSeekJSON as parseJSON, parseDeepSeekJSONArray, splitSentences, DEEPSEEK_MODEL as MODEL } from "@/lib/deepseek";

// 这是固定的边界声明，不依赖AI生成——保证这条边界100%出现，不会因为AI某次输出漏掉而消失
const BOUNDARY_NOTE = "以上拆解只分析原文「怎么说」（结构、节奏、修辞、情绪基调），不对原文「说的是什么」做对错、价值观或专业性判断。如果原文观点本身有问题，这个工具不会发现也不会指出，需要你自己判断。";

const BREAKDOWN_SYSTEM = `你是一位内容结构分析师，任务是拆解一段口播文案/逐字稿的内部结构，为后续的"风格化改写"提供锁定基准。

你必须严格遵守一条边界：你只分析这段内容"是怎么表达的"，绝不评价、纠正、暗示或质疑这段内容"说的对不对""观点是否合适""是否有依据"。即使你认为原文某个观点存疑、片面或者有争议，你也不能在任何字段里流露出这种判断——你的角色是结构分析师，不是内容审核员或事实核查员。如果原文包含数据/案例，你只描述"作者用它来论证什么"，不评估这些数据/案例本身是否准确可靠。

拆解出的"核心观点/核心案例/核心逻辑/核心结论"这四项，将在后续改写阶段被锁定为不可更改的硬约束，所以必须准确、完整地反映原文，不要加入你自己的归纳升华或简化，保持贴近原文的实际表述。

严格按JSON格式输出，不要输出任何其他文字。`;

const BREAKDOWN_PROMPT = (text: string) => `请拆解以下原始内容：

"""
${text}
"""

请严格按以下JSON格式输出：
{
  "coreElements": {
    "viewpoint": "这段内容的核心观点是什么，用原文的实际表述方式概括，不要替换成你自己的措辞",
    "cases": ["原文用到的案例/数据/例子，逐条列出，没有就给空数组"],
    "logic": "核心论证逻辑链，例如'先抛现象，再归因，最后给方法'，描述结构而不是复述内容",
    "conclusion": "核心结论或行动号召是什么"
  },
  "expressionAnalysis": {
    "openingHook": "开头用了什么方式抓住注意力，具体描述手法（例如：用提问引发好奇/用反常识陈述制造冲突/直接抛结论），不要评价好不好",
    "narrativeRhythm": "叙事节奏和句子长度特征，例如'短句密集，平均5-8字一句，靠快速转折制造紧迫感'",
    "emotionalTone": "情绪基调，例如'克制理性，少感叹号，靠数据和逻辑而非情绪渲染说服人'",
    "rhetoricDevices": ["用到的修辞/表达手法，例如对比、反问、类比、重复强调，列出实际用到的，没有明显手法就给空数组"],
    "closingStyle": "结尾/收尾方式，例如'用一句总结性金句收尾，没有明显的互动引导'"
  }
}`;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-DeepSeek-Key") || "";
  let body: { sourceText?: string };
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const text = (body.sourceText ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "请提供要拆解的原始内容", apiMeta: { apiCalled: false, calledAt: new Date().toISOString(), model: MODEL, ipUsed: null, mockHit: false } },
      { status: 400 }
    );
  }

  const calledAt = new Date().toISOString();
  const apiMeta = { apiCalled: true, calledAt, model: MODEL, ipUsed: null as string | null, mockHit: false };

  try {
    const raw = await callDeepSeek(BREAKDOWN_SYSTEM, BREAKDOWN_PROMPT(text), 1800, 0.3, apiKey);
    const parsed = parseJSON(raw, {
      coreElements: { viewpoint: "（AI返回内容解析失败，请重试）", cases: [] as string[], logic: "", conclusion: "" },
      expressionAnalysis: {
        openingHook: "", narrativeRhythm: "", emotionalTone: "",
        rhetoricDevices: [] as string[], closingStyle: "",
      },
    });

    return NextResponse.json({
      coreElements: parsed.coreElements,
      expressionAnalysis: parsed.expressionAnalysis,
      boundaryNote: BOUNDARY_NOTE,
      apiMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "拆解失败，请重试";
    return NextResponse.json({ error: message, apiMeta: { ...apiMeta, error: message } }, { status: 500 });
  }
}
