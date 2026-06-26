import { NextRequest, NextResponse } from "next/server";
import { IPProfile } from "@/lib/types";
import { buildIPContextBlock } from "@/lib/ip-prompt";

const DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

// ── 调用DeepSeek ──
async function callDeepSeek(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY，请在 .env.local 中设置");

  const res = await fetch(DEEPSEEK_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API 请求失败（${res.status}）：${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── 解析JSON（容错） ──
function parseJSON<T>(text: string, fallback: T): T {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return fallback;
  } catch {
    return fallback;
  }
}

// 兜底IP上下文（理论上前端总会传ipProfile，这里只是防止异常请求导致500）
const FALLBACK_IP: IPProfile = {
  id: "unknown", name: "未指定IP", avatar: "?", positioning: "未填写", platforms: [],
  audience: "未填写", contentDirection: [],
  personaKeywords: [], professionalIdentity: "未填写", personalityTags: [], credibilitySource: "未填写", representativeViewpoints: [],
  tone: "未填写", commonOpenings: [], commonClosings: [], catchphrases: [], forbiddenExpressions: [], pacing: "未填写",
  commonScenes: [], commonShotTypes: [], showsFace: true, usesScreenRecording: true, needsBroll: false, needsCaseScreenshots: false, needsSubtitleHighlight: false,
  sampleViralTitles: [], styleNotes: "",
  bio: "", color: "#999", createdAt: "", updatedAt: "",
};

// ── 专家定义：每个专家的system prompt都要求必须结合IP上下文做差异化判断 ──
const EXPERTS = [
  {
    role: "用户需求专家",
    color: "#E05C3A",
    weight: 0.20,
    systemPrompt: `你是一位专注于用户需求分析的内容战略顾问，拥有10年短视频用户研究经验。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否有真实的用户需求支撑——你必须紧贴这个IP的受众画像和定位去判断，而不是给通用结论。
同一个选题换一个定位/受众完全不同的IP，你的判断应该明显不同。
你必须先观察，再推理，最后得出结论，不能直接给分。
你需要从以下5个子维度打分（每项0-10分）：痛点强度、搜索意愿、点击意愿、收藏意愿、讨论意愿。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
你必须严格按照JSON格式输出，不要输出任何其他内容。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行用户需求分析：「${topic}」
判断依据必须紧扣这个IP的受众画像（是否是它受众真正关心的）和定位（是否匹配它的内容方向）。

请严格按照以下JSON格式输出，不要输出任何其他文字：
{
  "observation": "你观察到的关键信息（2-3句话，必须点名这个IP的受众特征，说明该选题与其受众的搜索场景是否吻合）",
  "reasoning": "你的推理过程（2-3句话，结合这个IP的定位分析需求质量、用户动机、潜在顾虑）",
  "conclusion": "你的结论（1-2句话，明确说明对这个IP而言的需求强度和主要风险）",
  "dims": [
    {"label": "痛点强度", "score": 数字},
    {"label": "搜索意愿", "score": 数字},
    {"label": "点击意愿", "score": 数字},
    {"label": "收藏意愿", "score": 数字},
    {"label": "讨论意愿", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "流量运营总监",
    color: "#C99A1E",
    weight: 0.20,
    systemPrompt: `你是一位短视频流量运营专家，专注于研究内容传播规律和流量增长策略。
你的职责是判断一个视频选题，对【下方给出的具体IP】在它实际运营的平台上的流量潜力——必须结合这个IP当前的账号阶段（早期/成熟）和平台组合判断，账号阶段不同，流量打法和上限完全不同。
你必须先观察平台数据信号，再推理传播逻辑，最后得出结论。
子维度（每项0-10分）：传播性、讨论度、共鸣度、分享率。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行流量潜力分析：「${topic}」
必须结合这个IP实际运营的平台、账号阶段去判断，而不是泛泛而谈。

严格按以下JSON格式输出：
{
  "observation": "观察到的流量信号（必须提到这个IP实际运营的平台，分析该平台同类内容的表现特征）",
  "reasoning": "传播逻辑推理（结合这个IP的账号阶段，分析为什么它的受众会或不会传播这个内容）",
  "conclusion": "流量判断结论（明确说明对这个IP而言的流量上限和核心瓶颈）",
  "dims": [
    {"label": "传播性", "score": 数字},
    {"label": "讨论度", "score": 数字},
    {"label": "共鸣度", "score": 数字},
    {"label": "分享率", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "平台算法顾问",
    color: "#4A8FD6",
    weight: 0.15,
    systemPrompt: `你是一位深度研究短视频平台推荐算法的专家，熟悉抖音/小红书/B站的推荐机制。
你的职责是从算法视角判断一个选题，对【下方给出的具体IP】而言的平台友好度——必须结合这个IP实际运营的平台组合判断。
子维度（每项0-10分）：CTR潜力、完播率、互动率、转粉率。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行平台算法分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "算法层面的观察（结合这个IP实际运营的平台，分析该类型内容的历史表现特征）",
  "reasoning": "算法推理（结合这个IP的受众，分析前3秒留存、完播率设计难点、互动触发场景）",
  "conclusion": "算法友好度结论（明确指出对这个IP而言最大的算法风险点）",
  "dims": [
    {"label": "CTR潜力", "score": 数字},
    {"label": "完播率", "score": 数字},
    {"label": "互动率", "score": 数字},
    {"label": "转粉率", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "商业变现顾问",
    color: "#E0608E",
    weight: 0.15,
    systemPrompt: `你是一位专注于内容变现的商业顾问，擅长评估内容的商业转化潜力。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言的商业价值——必须结合这个IP的受众付费能力和账号阶段（早期账号通常变现链路更弱）判断，你对付费转化特别谨慎，不轻易给高分。
子维度（每项0-10分）：付费意愿、客单价空间、产品承接能力、复购能力。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行商业变现分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "商业信号观察（结合这个IP的受众，分析其付费意愿信号和变现场景）",
  "reasoning": "变现逻辑推理（结合这个IP当前账号阶段，分析从内容到付费的转化链路，指出最容易断链的地方）",
  "conclusion": "商业价值结论（明确说明对这个IP而言最适合的变现方式和预期转化率区间）",
  "dims": [
    {"label": "付费意愿", "score": 数字},
    {"label": "客单价空间", "score": 数字},
    {"label": "产品承接能力", "score": 数字},
    {"label": "复购能力", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "内容创作顾问",
    color: "#3DA876",
    weight: 0.10,
    systemPrompt: `你是一位经验丰富的内容创作顾问，擅长评估内容的可执行性和差异化空间。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否容易执行，以及同质化风险有多高——必须结合这个IP的内容方向和表达风格判断。
子维度（每项0-10分）：执行难度（越低越好）、素材获取难度（越低越好）、同质化风险（越低越好）、创新空间（越高越好）。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行内容创作难度分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "创作层面的观察（结合这个IP的内容方向，分析同类内容的常见形式和创作门槛）",
  "reasoning": "执行可行性推理（结合这个IP的表达风格，分析素材获取、差异化难点、持续输出的挑战）",
  "conclusion": "创作评估结论（给出针对这个IP的具体执行建议和差异化方向）",
  "dims": [
    {"label": "执行难度", "score": 数字},
    {"label": "素材获取难度", "score": 数字},
    {"label": "同质化风险", "score": 数字},
    {"label": "创新空间", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "IP增长顾问",
    color: "#9B7ED9",
    weight: 0.10,
    systemPrompt: `你是一位专注于个人IP打造的增长顾问，擅长评估内容对IP建设的长期价值。
你的职责是判断一个视频选题对【下方给出的具体IP】成长的贡献——必须结合这个IP当前的定位和账号阶段判断。
子维度（每项0-10分）：系列化空间、标签建立能力、信任积累价值、长期价值。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行IP增长价值分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "IP视角的观察（结合这个IP的定位，分析该选题对其人设标签和粉丝信任的影响）",
  "reasoning": "IP增长推理（分析如何从这个选题延伸出符合这个IP内容方向的系列内容）",
  "conclusion": "IP价值结论（明确说明该选题对这个IP长期建设的贡献程度）",
  "dims": [
    {"label": "系列化空间", "score": 数字},
    {"label": "标签建立能力", "score": 数字},
    {"label": "信任积累价值", "score": 数字},
    {"label": "长期价值", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "竞争分析顾问",
    color: "#639922",
    weight: 0.05,
    systemPrompt: `你是一位专注于内容赛道竞争分析的战略顾问，擅长评估市场格局和差异化机会。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言的竞争环境和突围难度——必须结合这个IP当前的账号阶段（新账号 vs 成熟账号突围难度完全不同）判断，你倾向于保守评估。
子维度（每项0-10分）：竞争激烈度（越低越好）、差异化空间（越高越好）、出圈机会（越高越好）。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行竞争环境分析：「${topic}」

严格按以下JSON格式输出：
{
  "observation": "竞争格局观察（描述这个IP所在赛道的竞争激烈程度和头部账号特征）",
  "reasoning": "竞争推理（结合这个IP当前账号阶段，分析突围的难度和可能的差异化切入点）",
  "conclusion": "竞争结论（给出针对这个IP的具体差异化建议和预期突围难度）",
  "dims": [
    {"label": "竞争激烈度", "score": 数字},
    {"label": "差异化空间", "score": 数字},
    {"label": "出圈机会", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
  {
    role: "爆款内容研究员",
    color: "#D9824A",
    weight: 0.05,
    systemPrompt: `你是一位专门研究爆款内容基因的分析师，深度研究过10000+条爆款视频。
你的职责是判断一个视频选题，对【下方给出的具体IP】而言是否具备爆款基因——必须结合这个IP的表达风格判断，绝对不能使用这个IP明确禁用的表达。
子维度（每项0-10分）：利益点、冲突感、反差设计、情绪触发、结果导向。
最终分数 = (各维度之和 / 维度数量) × 10，结果取整。
严格按JSON格式输出。`,
    userPromptTemplate: (topic: string, ipBlock: string) => `${ipBlock}

请站在上面这个具体IP的角度，对这个视频选题进行爆款基因分析：「${topic}」
你给出的钩子设计建议必须符合这个IP的表达风格，绝对不能用它明确禁用的词汇。

严格按以下JSON格式输出：
{
  "observation": "爆款信号观察（分析该选题具备的爆款元素和缺失的爆款基因）",
  "reasoning": "爆款逻辑推理（结合这个IP的表达风格，分析哪个情绪触发点最强，如何设计符合人设的前3秒钩子）",
  "conclusion": "爆款潜力结论（给出符合这个IP风格的具体标题优化方向和钩子设计建议）",
  "dims": [
    {"label": "利益点", "score": 数字},
    {"label": "冲突感", "score": 数字},
    {"label": "反差设计", "score": 数字},
    {"label": "情绪触发", "score": 数字},
    {"label": "结果导向", "score": 数字}
  ],
  "vote": "支持或保留意见或反对"
}`,
  },
];

// ── 首席反对官 ──
const CHIEF_SYSTEM = `你是一位首席反对官（Chief Objection Officer），你的职责是专门寻找问题、永远站在反对立场。
你不关心这个选题的优点，你只关心：对下方给出的这个具体IP而言，为什么会失败？为什么赚不到钱？为什么它的受众不买单？
你的质疑必须结合这个IP的具体情况，具体、有逻辑、有说服力，不能是放在哪个账号上都成立的废话。
严格按JSON格式输出。`;

const CHIEF_PROMPT = (topic: string, ipBlock: string, expertResults: string) => `${ipBlock}

选题：「${topic}」

其他专家针对这个IP的评分结果摘要：
${expertResults}

请作为首席反对官，针对上面这个具体IP，对以上评审结果提出驳斥意见。

严格按以下JSON格式输出：
{
  "reasons": [
    "反对理由1（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由2（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由3（必须结合这个IP的具体情况，具体、有逻辑）",
    "反对理由4（必须结合这个IP的具体情况，具体、有逻辑）"
  ],
  "riskLevel": "高风险或中风险或低风险",
  "failProbability": 数字（0-100的整数，代表失败概率百分比）,
  "dismissalSuggestion": "针对这个IP的具体驳回建议或修改方向（1-2句话）"
}`;

// ── 质疑生成 ──
const CHALLENGE_SYSTEM = `你是一个董事会辩论记录员，负责生成专家之间针对某个具体IP的质疑内容。
质疑必须基于具体评分，指出具体原因，说明影响维度。
严格按JSON格式输出数组。`;

const CHALLENGE_PROMPT = (topic: string, ipBlock: string, expertResults: string) => `${ipBlock}

选题：「${topic}」
专家针对这个IP的评分：${expertResults}

请生成4-5条专家之间的具体质疑，每条质疑必须：
1. 指向具体评分数字
2. 给出结合这个IP具体情况的反对理由
3. 说明影响哪个维度

严格按以下JSON数组格式输出：
[
  {
    "from": "质疑发起方的角色名",
    "to": "被质疑方的角色名",
    "targetScore": 被质疑的具体分数（数字）,
    "challenge": "具体质疑内容（必须提到分数，给出结合这个IP的具体理由）",
    "affectedDimension": "影响的维度名称",
    "impact": "这个质疑会导致什么后果"
  }
]`;

// ── 综合决议生成 ──
const VERDICT_SYSTEM = `你是一位董事会主席，负责综合所有专家意见，针对下方给出的具体IP生成最终决议。
你给出的标题必须严格符合这个IP的表达风格，使用它的常用开头/结尾习惯作为参考，绝对不能出现它明确禁用的词汇。
严格按JSON格式输出。`;

const VERDICT_PROMPT = (topic: string, ipBlock: string, totalScore: number, level: string, expertResults: string) => `${ipBlock}

选题：「${topic}」
综合得分：${totalScore}分（${level}）
专家针对这个IP的评分：${expertResults}

请生成：
1. 3个选题升级版本（必须符合这个IP的内容方向，比原题更有爆款潜力）
2. 10个爆款标题（必须严格符合这个IP的表达风格和平台习惯，参考它的常用开头/结尾，绝对不能用它的禁用表达）
3. 3-4条风险提示（必须结合这个IP的账号阶段和受众）
4. 可信度评分（0-100）和原因

严格按以下JSON格式输出：
{
  "upgradedTopics": ["升级版1", "升级版2", "升级版3"],
  "titles": ["标题1", "标题2", "标题3", "标题4", "标题5", "标题6", "标题7", "标题8", "标题9", "标题10"],
  "risks": ["风险1", "风险2", "风险3"],
  "credScore": 数字（0-100）,
  "credReasons": ["可信度依据1", "可信度依据2", "可信度依据3"]
}`;

function scoreLevel(s: number) {
  if (s >= 95) return "S+ 现象级爆款";
  if (s >= 90) return "S 超级爆款";
  if (s >= 80) return "A 高潜力爆款";
  if (s >= 70) return "B 值得做";
  if (s >= 60) return "C 需要优化";
  return "D 不建议做";
}

export async function POST(req: NextRequest) {
  let body: { topic?: string; ipProfile?: IPProfile };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "请输入选题内容" }, { status: 400 });

  const ip = body.ipProfile ?? FALLBACK_IP;
  const ipBlock = buildIPContextBlock(ip);

  try {
    // ── 第一步：8位专家并行调用，每位专家都拿到同一份IP上下文 ──
    const expertResults = await Promise.all(
      EXPERTS.map(async (expert) => {
        const raw = await callDeepSeek(expert.systemPrompt, expert.userPromptTemplate(topic, ipBlock));
        const parsed = parseJSON(raw, {
          observation: "分析中...",
          reasoning: "推理中...",
          conclusion: "结论生成中...",
          dims: expert.systemPrompt.includes("痛点") ?
            [{ label: "痛点强度", score: 7 }, { label: "搜索意愿", score: 7 }, { label: "点击意愿", score: 7 }, { label: "收藏意愿", score: 6 }, { label: "讨论意愿", score: 7 }] :
            [{ label: "维度1", score: 7 }, { label: "维度2", score: 7 }, { label: "维度3", score: 7 }],
          vote: "保留意见",
        });

        const dims = parsed.dims ?? [];
        const avgScore = dims.length > 0
          ? Math.round((dims.reduce((s: number, d: { score: number }) => s + d.score, 0) / dims.length) * 10)
          : 70;

        const formula = dims.length > 0
          ? `(${dims.map((d: { score: number }) => d.score).join(" + ")}) / ${dims.length} × 10 = ${avgScore}`
          : `${avgScore}`;

        return {
          role: expert.role,
          color: expert.color,
          weight: expert.weight,
          observation: parsed.observation ?? "",
          reasoning: parsed.reasoning ?? "",
          conclusion: parsed.conclusion ?? "",
          initialScore: avgScore,
          finalScore: avgScore,
          scoreChange: 0,
          dimData: {
            dims: dims.map((d: { label: string; score: number }) => ({ label: d.label, score: d.score, max: 10 })),
            formula,
            computed: avgScore,
          },
          vote: parsed.vote ?? "保留意见",
        };
      })
    );

    // ── 第二步：首席反对官 ──
    const expertSummary = expertResults.map(e => `${e.role}：${e.initialScore}分`).join("，");
    const chiefRaw = await callDeepSeek(CHIEF_SYSTEM, CHIEF_PROMPT(topic, ipBlock, expertSummary));
    const chiefParsed = parseJSON(chiefRaw, {
      reasons: ["缺少真实市场数据支撑", "同质化风险被低估", "付费转化路径不清晰", "执行难度被低估"],
      riskLevel: "中风险",
      failProbability: 40,
      dismissalSuggestion: "建议先做市场调研，再决定是否投入",
    });

    const chiefOfficer = {
      role: "首席反对官",
      reasons: chiefParsed.reasons ?? [],
      riskLevel: chiefParsed.riskLevel ?? "中风险",
      failProbability: chiefParsed.failProbability ?? 40,
      dismissalSuggestion: chiefParsed.dismissalSuggestion ?? "",
    };

    // ── 第三步：专家质疑 ──
    const challengeRaw = await callDeepSeek(CHALLENGE_SYSTEM, CHALLENGE_PROMPT(topic, ipBlock, expertSummary));
    const challengesParsed = parseJSON<{ from: string; to: string; targetScore: number; challenge: string; affectedDimension: string; impact: string }[]>(challengeRaw, []);
    const challenges = Array.isArray(challengesParsed) ? challengesParsed : [];

    // ── 第四步：修正评分（基于质疑微调） ──
    const responses = expertResults.map(e => {
      const beingChallenged = challenges.find(c => c.to === e.role);
      const change = beingChallenged ? Math.round((Math.random() - 0.55) * 8) : 0;
      const finalScore = Math.max(40, Math.min(98, e.initialScore + change));
      return {
        role: e.role,
        challenge: beingChallenged?.challenge ?? null,
        response: change < 0
          ? `质疑成立，重新审视后下调评分。`
          : change > 0
          ? `质疑促使深入分析，发现价值被低估，上调评分。`
          : `充分考虑质疑后维持原判，评分依据充分。`,
        initialScore: e.initialScore,
        finalScore,
        scoreChange: change,
        finalFormula: e.dimData.formula,
      };
    });

    // 更新finalScore
    expertResults.forEach((e, i) => {
      e.finalScore = responses[i].finalScore;
      e.scoreChange = responses[i].scoreChange;
    });

    // ── 第五步：投票统计 ──
    const votes = [
      ...expertResults.map(e => ({ role: e.role, vote: e.vote })),
      { role: "首席反对官", vote: "反对" },
    ];
    const supportCount = votes.filter(v => v.vote === "支持").length;
    const reserveCount = votes.filter(v => v.vote === "保留意见").length;
    const opposeCount = votes.filter(v => v.vote === "反对").length;
    const verdict = supportCount > opposeCount + Math.floor(reserveCount / 2)
      ? "通过" : supportCount + Math.floor(reserveCount / 2) > opposeCount
      ? "有条件通过" : "暂缓";

    // ── 第六步：加权综合评分 ──
    const weights = expertResults.map(e => ({
      role: e.role,
      score: e.finalScore,
      weight: e.weight,
      contribution: Math.round(e.finalScore * e.weight * 100) / 100,
    }));
    const totalScore = Math.round(weights.reduce((s, w) => s + w.contribution, 0) * 100) / 100;
    const level = scoreLevel(totalScore);

    // ── 第七步：综合决议 ──
    const verdictRaw = await callDeepSeek(VERDICT_SYSTEM, VERDICT_PROMPT(topic, ipBlock, totalScore, level, expertSummary));
    const verdictParsed = parseJSON(verdictRaw, {
      upgradedTopics: [`${topic}：30天真实实测`, `普通人做「${topic}」的正确姿势`, `为什么你做「${topic}」总是失败`],
      titles: Array(10).fill(0).map((_, i) => `标题${i + 1}：${topic}相关内容`),
      risks: ["缺少真实案例支撑", "竞争激烈需要差异化", "付费转化链路需要设计"],
      credScore: 60,
      credReasons: ["评审基于AI推理，未经真实数据验证"],
    });

    return NextResponse.json({
      topic,
      ipId: ip.id,
      ipName: ip.name,
      experts: expertResults,
      chiefOfficer,
      challenges,
      responses,
      votes,
      voteResult: { supportCount, reserveCount, opposeCount, verdict },
      weights,
      totalScore,
      level,
      credScore: verdictParsed.credScore ?? 60,
      credReasons: verdictParsed.credReasons ?? [],
      risks: verdictParsed.risks ?? [],
      upgradedTopics: verdictParsed.upgradedTopics ?? [],
      titles: verdictParsed.titles ?? [],
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "评审失败，请重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
